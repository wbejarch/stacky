import type { Writable } from 'node:stream';
import { vi } from 'vitest';
import { ChatStreamEventSchema, type ChatStreamEvent } from '@tutor-agent/shared';

export interface ResponseMetadata {
  statusCode?: number;
  headers?: Record<string, string>;
}

/** Fake Lambda response stream that records writes and detects writes after `end()`. */
export class FakeResponseStream {
  readonly chunks: string[] = [];
  ended = false;
  writesAfterEnd = 0;

  write(chunk: unknown): boolean {
    if (this.ended) this.writesAfterEnd += 1;
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
    return true;
  }

  end(): void {
    this.ended = true;
  }

  get output(): string {
    return this.chunks.join('');
  }

  asWritable(): Writable {
    return this as unknown as Writable;
  }
}

/**
 * Installs a minimal `awslambda` global (same idea as the local dev server):
 * `streamifyResponse` is the identity and `HttpResponseStream.from` records the
 * metadata and returns the same stream. Call BEFORE importing `handlers/chat`.
 */
export function installAwsLambdaStub(): ResponseMetadata[] {
  const captured: ResponseMetadata[] = [];
  vi.stubGlobal('awslambda', {
    streamifyResponse: <T>(handler: T): T => handler,
    HttpResponseStream: {
      from: (stream: unknown, metadata: ResponseMetadata) => {
        captured.push(metadata);
        return stream;
      },
    },
  });
  return captured;
}

export interface ParsedFrame {
  raw: string;
  event: ChatStreamEvent;
}

/**
 * Parses an SSE body into validated `ChatStreamEvent`s. Throws if a frame is not
 * exactly `event: <name>\ndata: <json>` terminated by a blank line.
 */
export function parseSse(output: string): ParsedFrame[] {
  if (output.length === 0) return [];
  if (!output.endsWith('\n\n')) throw new Error('SSE output does not end with a blank line');
  return output
    .slice(0, -2)
    .split('\n\n')
    .map((raw) => {
      const lines = raw.split('\n');
      if (lines.length !== 2) throw new Error(`Unexpected SSE frame shape: ${JSON.stringify(raw)}`);
      const [eventLine, dataLine] = lines as [string, string];
      if (!eventLine.startsWith('event: ') || !dataLine.startsWith('data: ')) {
        throw new Error(`Malformed SSE frame: ${JSON.stringify(raw)}`);
      }
      const event = ChatStreamEventSchema.parse({
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)) as unknown,
      });
      return { raw, event };
    });
}
