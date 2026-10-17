/**
 * Single HTTP and SSE exit point of the front end (Requirements 8.1 to 8.7).
 *
 * - Base URL comes from `import.meta.env.VITE_API_URL`; when empty or unset the
 *   client uses relative `/api/...` paths.
 * - Every request carries `X-Session-Id`, generated once per tab and kept in
 *   `sessionStorage` (with an in-memory fallback when storage is unavailable).
 * - Every response is validated with the schemas from `@tutor-agent/shared`.
 *   Failures surface as a typed `ApiClientError`.
 * - This module holds no credentials or secrets.
 */
import {
  ApiErrorSchema,
  ChatStreamEventSchema,
  ExerciseSchema,
  HintResponseSchema,
  LessonSchema,
  ModuleSchema,
  ProgressSchema,
  RunResultSchema,
  type ApiError,
  type ChatRequest,
  type Exercise,
  type HintRequest,
  type HintResponse,
  type Lesson,
  type Module,
  type Progress,
  type RunRequest,
  type RunResult,
} from '@tutor-agent/shared';
import { parseSse } from './sse';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Failure categories:
 * - `network`: the request could not reach the server.
 * - `http`: the server answered with a non-2xx status (see `status` and `apiError`).
 * - `schema`: the response body was not valid JSON or did not match the contract.
 * - `stream`: the SSE response was unusable (no body, wrong content type).
 * - `aborted`: the request was cancelled through its `AbortSignal`.
 */
export type ApiClientErrorKind = 'network' | 'http' | 'schema' | 'stream' | 'aborted';

const MESSAGES = {
  network: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
  server: 'El servidor tuvo un problema. Inténtalo de nuevo en un momento.',
  client: 'La solicitud no es válida. Revisa los datos e inténtalo de nuevo.',
  notFound: 'No encontramos lo que buscabas.',
  schema: 'La respuesta del servidor no tiene el formato esperado. Inténtalo de nuevo.',
  stream: 'La conversación con el tutor se interrumpió. Inténtalo de nuevo.',
  aborted: 'La solicitud fue cancelada.',
} as const;

export interface ApiClientErrorInit {
  kind: ApiClientErrorKind;
  message: string;
  status?: number;
  apiError?: ApiError;
  cause?: unknown;
}

/**
 * Typed error thrown by every client function. `message` is a generic Spanish
 * text that is safe to show to the student; it never contains server internals.
 * The raw `ApiError` (if the server sent a valid one) is available in `apiError`.
 */
export class ApiClientError extends Error {
  readonly kind: ApiClientErrorKind;
  readonly status?: number;
  readonly apiError?: ApiError;

  constructor(init: ApiClientErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiClientError';
    this.kind = init.kind;
    if (init.status !== undefined) this.status = init.status;
    if (init.apiError !== undefined) this.apiError = init.apiError;
  }

  /** True when retrying the same request may succeed (network failure or 5xx). */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'stream' || (this.kind === 'http' && (this.status ?? 0) >= 500);
  }
}

function messageForStatus(status: number): string {
  if (status >= 500) return MESSAGES.server;
  if (status === 404) return MESSAGES.notFound;
  return MESSAGES.client;
}

// ---------------------------------------------------------------------------
// Session id
// ---------------------------------------------------------------------------

const SESSION_STORAGE_KEY = 'tutor-agent.sessionId';
let memorySessionId: string | undefined;

function generateId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Returns the identifier of this tab's session. It is generated once and kept
 * in `sessionStorage`; if storage is unavailable (privacy modes, sandboxed
 * frames) the id lives in memory for the lifetime of the page.
 */
export function getSessionId(): string {
  if (memorySessionId) return memorySessionId;

  let id: string | null;
  try {
    id = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    id = null; // Storage unavailable.
  }

  if (!id) {
    id = generateId();
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    } catch {
      // Storage unavailable: keep the id in memory only.
    }
  }

  memorySessionId = id;
  return id;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** Minimal structural type of a zod schema, so `web/` needs no direct zod import. */
interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** Builds the full URL for an API path. Empty `VITE_API_URL` gives a relative path. */
function buildUrl(path: string): string {
  const base = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
  return `${base}${path}`;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof DOMException && error.name === 'AbortError';
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'X-Session-Id': getSessionId(), ...extra };
}

/** `fetch` wrapper that maps transport failures to `ApiClientError`. */
async function send(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(buildUrl(path), signal ? { ...init, signal } : init);
  } catch (error) {
    if (isAbortError(error, signal)) {
      throw new ApiClientError({ kind: 'aborted', message: MESSAGES.aborted, cause: error });
    }
    throw new ApiClientError({ kind: 'network', message: MESSAGES.network, cause: error });
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Builds the error for a non-2xx response, reading an `ApiError` body when present. */
async function httpError(response: Response): Promise<ApiClientError> {
  const parsed = ApiErrorSchema.safeParse(await readJson(response));
  return new ApiClientError({
    kind: 'http',
    message: messageForStatus(response.status),
    status: response.status,
    ...(parsed.success ? { apiError: parsed.data } : {}),
  });
}

async function requestJson<T>(
  path: string,
  schema: Parser<T>,
  init: { method: 'GET' } | { method: 'POST'; body: unknown },
  signal?: AbortSignal,
): Promise<T> {
  const requestInit: RequestInit =
    init.method === 'POST'
      ? {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
          body: JSON.stringify(init.body),
        }
      : { method: 'GET', headers: buildHeaders({ Accept: 'application/json' }) };

  const response = await send(path, requestInit, signal);
  if (!response.ok) {
    throw await httpError(response);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbortError(error, signal)) {
      throw new ApiClientError({ kind: 'aborted', message: MESSAGES.aborted, cause: error });
    }
    throw new ApiClientError({ kind: 'schema', message: MESSAGES.schema, status: response.status, cause: error });
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiClientError({ kind: 'schema', message: MESSAGES.schema, status: response.status });
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** Optional per-call settings for the JSON endpoints. */
export interface RequestOptions {
  signal?: AbortSignal;
}

/** `GET /api/modules` */
export function getModules(options?: RequestOptions): Promise<Module[]> {
  return requestJson('/api/modules', arrayOf(ModuleSchema), { method: 'GET' }, options?.signal);
}

/** `GET /api/modules/{id}/lesson` */
export function getLesson(moduleId: string, options?: RequestOptions): Promise<Lesson> {
  return requestJson(
    `/api/modules/${encodeURIComponent(moduleId)}/lesson`,
    LessonSchema,
    { method: 'GET' },
    options?.signal,
  );
}

/** `GET /api/exercises/{id}` */
export function getExercise(exerciseId: string, options?: RequestOptions): Promise<Exercise> {
  return requestJson(
    `/api/exercises/${encodeURIComponent(exerciseId)}`,
    ExerciseSchema,
    { method: 'GET' },
    options?.signal,
  );
}

/** `POST /api/hint` */
export function postHint(request: HintRequest, options?: RequestOptions): Promise<HintResponse> {
  return requestJson('/api/hint', HintResponseSchema, { method: 'POST', body: request }, options?.signal);
}

/** `POST /api/run` */
export function postRun(request: RunRequest, options?: RequestOptions): Promise<RunResult> {
  return requestJson('/api/run', RunResultSchema, { method: 'POST', body: request }, options?.signal);
}

/** `GET /api/progress` */
export function getProgress(options?: RequestOptions): Promise<Progress> {
  return requestJson('/api/progress', ProgressSchema, { method: 'GET' }, options?.signal);
}

/** Parser for a JSON array whose items match `item`. */
function arrayOf<T>(item: Parser<T>): Parser<T[]> {
  return {
    safeParse(data: unknown) {
      if (!Array.isArray(data)) return { success: false };
      const items: T[] = [];
      for (const value of data as unknown[]) {
        const parsed = item.safeParse(value);
        if (!parsed.success) return { success: false };
        items.push(parsed.data);
      }
      return { success: true, data: items };
    },
  };
}

// ---------------------------------------------------------------------------
// Chat streaming
// ---------------------------------------------------------------------------

/** Callbacks for `streamChat`. Exactly one of `onDone` or `onError` is called per stream. */
export interface ChatStreamHandlers {
  /** A fragment of the tutor reply arrived. */
  onToken: (text: string) => void;
  /** The reply finished normally (terminal event). */
  onDone: () => void;
  /** The stream failed after it started, or the server sent an `error` event (terminal). */
  onError: (message: string) => void;
}

/**
 * Sends `POST /api/chat` and processes the SSE reply as it arrives.
 *
 * Error contract:
 * - Failures BEFORE the stream starts (network error, non-2xx status such as a
 *   400 `ApiError`, missing body) reject with `ApiClientError`; no handler is called.
 * - Failures AFTER the stream starts (server `error` event, invalid frame,
 *   connection lost, stream ending without `done`/`error`) call `onError` with a
 *   Spanish message and the promise resolves.
 * - Cancellation: when `signal` is aborted (the caller owns the `AbortController`)
 *   the promise resolves quietly and NO handler is called, whether the abort
 *   happens before or during the stream.
 *
 * The stream is read until the first terminal event (`done` or `error`); any
 * frame after it is ignored and the connection is released.
 */
export async function streamChat(
  request: ChatRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await send(
      '/api/chat',
      {
        method: 'POST',
        headers: buildHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        body: JSON.stringify(request),
      },
      signal,
    );
  } catch (error) {
    if (error instanceof ApiClientError && error.kind === 'aborted') return;
    throw error;
  }

  if (!response.ok) {
    throw await httpError(response);
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!response.body || !contentType.toLowerCase().includes('text/event-stream')) {
    // Release the connection before reporting.
    await response.body?.cancel().catch(() => undefined);
    throw new ApiClientError({ kind: 'stream', message: MESSAGES.stream, status: response.status });
  }

  try {
    for await (const frame of parseSse(response.body)) {
      const event = parseChatFrame(frame.event, frame.data);
      if (!event) {
        handlers.onError(MESSAGES.stream);
        return;
      }

      if (event.event === 'token') {
        handlers.onToken(event.data.text);
      } else if (event.event === 'done') {
        handlers.onDone();
        return;
      } else {
        handlers.onError(event.data.message);
        return;
      }
    }
  } catch (error) {
    if (isAbortError(error, signal)) return;
    handlers.onError(MESSAGES.stream);
    return;
  }

  // The stream ended without a terminal event.
  if (signal?.aborted) return;
  handlers.onError(MESSAGES.stream);
}

/** Validates one SSE frame against `ChatStreamEventSchema`. Returns `undefined` when invalid. */
function parseChatFrame(event: string, data: string) {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  const result = ChatStreamEventSchema.safeParse({ event, data: json });
  return result.success ? result.data : undefined;
}
