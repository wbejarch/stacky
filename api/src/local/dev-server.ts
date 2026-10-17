/**
 * Local API server for development (`npm run dev -w api`).
 *
 * A small `node:http` adapter that turns each request into an API Gateway REST
 * proxy event, calls the same handlers that run in Lambda and writes the result
 * back. Vite proxies `/api` to this server, so the front end behaves as it will
 * behind CloudFront. It is NOT bundled or deployed.
 */
import { register } from 'node:module';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Writable } from 'node:stream';
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

const DEFAULT_PORT = 3001;
const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5173';
/** Raw bodies above this size are rejected here; the handlers enforce the real 64 KB cap. */
const MAX_RAW_BODY_BYTES = 1024 * 1024;

// Local defaults. Set before the handlers are imported so they read them.
process.env['ALLOWED_ORIGINS'] ??= DEFAULT_ALLOWED_ORIGINS;

// --- Environment shims (must run BEFORE the handlers are imported) -----------

/**
 * `lib/content.ts` imports `leccion.md` as text (esbuild `text` loader when
 * bundling, a Vitest plugin in tests). Node and tsx have no `.md` loader, so
 * register an equivalent one.
 */
const MARKDOWN_LOADER_HOOKS = `
export async function load(url, context, nextLoad) {
  if (url.split('?')[0].endsWith('.md')) {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const text = await readFile(fileURLToPath(url.split('?')[0]), 'utf8');
    return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(text) + ';' };
  }
  return nextLoad(url, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(MARKDOWN_LOADER_HOOKS)}`);

/** Metadata passed to `HttpResponseStream.from`. */
interface ResponseMetadata {
  statusCode?: number;
  headers?: Record<string, string>;
}

/**
 * Minimal `awslambda` global, as in the Lambda Node.js runtime:
 * `streamifyResponse` is the identity and `HttpResponseStream.from` writes the
 * status and headers on the Node response and returns it as the body stream.
 */
Object.assign(globalThis, {
  awslambda: {
    streamifyResponse: <T>(handler: T): T => handler,
    HttpResponseStream: {
      from(stream: unknown, metadata: ResponseMetadata): unknown {
        const res = stream as ServerResponse;
        res.writeHead(metadata.statusCode ?? 200, metadata.headers ?? {});
        res.flushHeaders();
        return res;
      },
    },
  },
});

// Dynamic imports: `chat.ts` reads `awslambda` when it is evaluated.
const { corsHeaders, createApiError, errorResponse, getHeader, INTERNAL_ERROR_MESSAGE, statusForCode } = await import(
  '../lib/http'
);
const { log } = await import('../lib/logger');
const { handler: contentHandler } = await import('../handlers/content');
const { handler: hintHandler } = await import('../handlers/hint');
const { handler: runHandler } = await import('../handlers/run');
const { handler: progressHandler } = await import('../handlers/progress');
const { chatHandler } = await import('../handlers/chat');

// --- Routing ----------------------------------------------------------------

type BufferedHandler = (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

type Route =
  | { kind: 'buffered'; resource: string; pathParameters: Record<string, string> | null; handler: BufferedHandler }
  | { kind: 'chat'; resource: string };

/** Matches a request to a handler, the way the API Gateway resource tree does. */
function matchRoute(method: string, path: string): Route | undefined {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments[0] !== 'api') return undefined;
  const [, a, b, c] = segments;
  const length = segments.length;

  if (method === 'GET') {
    if (length === 2 && a === 'modules') {
      return { kind: 'buffered', resource: '/api/modules', pathParameters: null, handler: contentHandler };
    }
    if (length === 4 && a === 'modules' && b && c === 'lesson') {
      return {
        kind: 'buffered',
        resource: '/api/modules/{id}/lesson',
        pathParameters: { id: decodeURIComponent(b) },
        handler: contentHandler,
      };
    }
    if (length === 3 && a === 'exercises' && b) {
      return {
        kind: 'buffered',
        resource: '/api/exercises/{id}',
        pathParameters: { id: decodeURIComponent(b) },
        handler: contentHandler,
      };
    }
    if (length === 2 && a === 'progress') {
      return { kind: 'buffered', resource: '/api/progress', pathParameters: null, handler: progressHandler };
    }
  }

  if (method === 'POST' && length === 2) {
    if (a === 'chat') return { kind: 'chat', resource: '/api/chat' };
    if (a === 'hint') return { kind: 'buffered', resource: '/api/hint', pathParameters: null, handler: hintHandler };
    if (a === 'run') return { kind: 'buffered', resource: '/api/run', pathParameters: null, handler: runHandler };
  }

  return undefined;
}

// --- HTTP <-> API Gateway adapter -------------------------------------------

/** Thrown when the raw request body exceeds `MAX_RAW_BODY_BYTES`. */
class BodyTooLargeError extends Error {}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_RAW_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(buffer);
  }
  return size === 0 ? null : Buffer.concat(chunks).toString('utf8');
}

function singleValueHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

/** Builds an API Gateway REST proxy event (the subset the handlers use, fully typed). */
function buildEvent(
  req: IncomingMessage,
  url: URL,
  route: Route,
  body: string | null,
  requestId: string,
): APIGatewayProxyEvent {
  const queryStringParameters: Record<string, string> = {};
  for (const [key, value] of url.searchParams) queryStringParameters[key] = value;
  const headers = singleValueHeaders(req);
  const multiValueHeaders: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(headers)) multiValueHeaders[name] = [value];

  return {
    httpMethod: req.method ?? 'GET',
    path: url.pathname,
    resource: route.resource,
    pathParameters: route.kind === 'buffered' ? route.pathParameters : null,
    queryStringParameters: Object.keys(queryStringParameters).length > 0 ? queryStringParameters : null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    headers,
    multiValueHeaders,
    body,
    isBase64Encoded: false,
    requestContext: { requestId, stage: 'local' } as APIGatewayProxyEvent['requestContext'],
  };
}

function buildContext(requestId: string): Context {
  return { awsRequestId: requestId, functionName: 'local-dev-server' } as Context;
}

/** Local stand-in for the API Gateway CORS preflight (a mock integration when deployed). */
function preflightHeaders(origin: string | undefined): Record<string, string> {
  const headers = corsHeaders(origin);
  if (headers['Access-Control-Allow-Origin']) {
    headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type,X-Session-Id';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

function sendResult(res: ServerResponse, result: APIGatewayProxyResult): void {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.headers ?? {})) headers[name] = String(value);
  res.writeHead(result.statusCode, headers);
  res.end(result.body);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = crypto.randomUUID();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  const origin = getHeader(singleValueHeaders(req), 'Origin');

  if (method === 'OPTIONS') {
    res.writeHead(204, preflightHeaders(origin));
    res.end();
    return;
  }

  const route = matchRoute(method, url.pathname);
  if (!route) {
    sendResult(res, errorResponse('not_found', 'Resource not found', origin));
    return;
  }

  let body: string | null;
  try {
    body = method === 'POST' ? await readBody(req) : null;
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendResult(res, errorResponse('payload_too_large', 'Request body is too large', origin));
      return;
    }
    throw error;
  }

  const event = buildEvent(req, url, route, body, requestId);
  const context = buildContext(requestId);

  if (route.kind === 'chat') {
    await chatHandler(event, res as unknown as Writable, context);
    return;
  }
  sendResult(res, await route.handler(event, context));
}

/** Last-resort handler: generic 500, details only in the log. */
function handleFailure(res: ServerResponse, error: unknown, origin: string | undefined): void {
  log('error', 'dev-server failure', {
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
  });
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(statusForCode('internal_error'), {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify(createApiError('internal_error', INTERNAL_ERROR_MESSAGE)));
}

function startServer(port: number): Server {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      handleFailure(res, error, getHeader(singleValueHeaders(req), 'Origin'));
    });
  });
  server.listen(port, () => {
    log('info', 'local API server listening', {
      url: `http://localhost:${port}`,
      allowedOrigins: process.env['ALLOWED_ORIGINS'],
    });
  });
  return server;
}

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env['PORT'] ?? ''}`);
}
startServer(port);
