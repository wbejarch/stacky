/**
 * Pure Server-Sent Events parser over a `ReadableStream<Uint8Array>`.
 *
 * It only deals with framing: it knows nothing about `fetch`, JSON or the chat
 * contract. Validation of `data` against `ChatStreamEventSchema` belongs to
 * `client.ts`.
 *
 * Supported input:
 * - frames split at any byte boundary (including inside a multi-byte UTF-8 character)
 * - `\n`, `\r\n` and `\r` line endings (a `\r\n` pair split across chunks too)
 * - multi-line `data:` fields, joined with `"\n"`
 * - comment lines (starting with `:`) and unknown fields, which are ignored
 * - a trailing frame that is not followed by a blank line at the end of the stream
 */

/** A raw SSE frame. `event` defaults to `"message"` when the frame has no `event:` field. */
export interface SseFrame {
  event: string;
  data: string;
}

const DEFAULT_EVENT = 'message';
const BOM = '\uFEFF';

/** Accumulates the fields of the frame currently being read. */
class FrameBuilder {
  private event = '';
  private dataLines: string[] = [];

  /** Feeds one line (without its terminator). Returns a frame when a blank line closes one. */
  pushLine(line: string): SseFrame | undefined {
    if (line === '') {
      return this.flush();
    }
    if (line.startsWith(':')) {
      return undefined; // comment
    }

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'event') {
      this.event = value;
    } else if (field === 'data') {
      this.dataLines.push(value);
    }
    // `id`, `retry` and unknown fields are not used by this app.
    return undefined;
  }

  /** Emits the pending frame, if it has data, and resets the state. */
  flush(): SseFrame | undefined {
    const hasData = this.dataLines.length > 0;
    const frame: SseFrame | undefined = hasData
      ? { event: this.event === '' ? DEFAULT_EVENT : this.event, data: this.dataLines.join('\n') }
      : undefined;
    this.event = '';
    this.dataLines = [];
    return frame;
  }
}

/**
 * Splits `buffer` into complete lines. Returns the lines and the unconsumed rest.
 * A trailing `\r` is kept in the rest unless `final` is true, because the next
 * chunk may start with the `\n` of a `\r\n` pair.
 */
function splitLines(buffer: string, final: boolean): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  let i = 0;

  while (i < buffer.length) {
    const ch = buffer.charAt(i);
    if (ch === '\n') {
      lines.push(buffer.slice(start, i));
      i += 1;
      start = i;
    } else if (ch === '\r') {
      if (i + 1 >= buffer.length && !final) {
        break; // wait to know whether a `\n` follows
      }
      lines.push(buffer.slice(start, i));
      i += buffer.charAt(i + 1) === '\n' ? 2 : 1;
      start = i;
    } else {
      i += 1;
    }
  }

  return { lines, rest: buffer.slice(start) };
}

/**
 * Parses an SSE byte stream and yields one frame per event.
 *
 * The generator releases the stream when it finishes, throws, or the consumer
 * stops iterating early (`break`/`return`), cancelling the underlying stream in
 * the last case.
 */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  const builder = new FrameBuilder();
  let buffer = '';
  let atStart = true;
  let finished = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        buffer += decoder.decode(); // flush any partial character
      } else {
        buffer += decoder.decode(value, { stream: true });
      }

      if (atStart && buffer.length > 0) {
        if (buffer.startsWith(BOM)) {
          buffer = buffer.slice(BOM.length);
        }
        atStart = false;
      }

      const { lines, rest } = splitLines(buffer, done);
      buffer = rest;

      for (const line of lines) {
        const frame = builder.pushLine(line);
        if (frame) {
          yield frame;
        }
      }

      if (done) {
        // The stream ended without a final blank line: process an unterminated
        // last line and emit the pending frame.
        const last = buffer === '' ? undefined : builder.pushLine(buffer);
        if (last) {
          yield last;
        }
        const trailing = builder.flush();
        if (trailing) {
          yield trailing;
        }
        finished = true;
        return;
      }
    }
  } finally {
    if (!finished) {
      // Early exit or error: stop the producer, ignoring cancellation failures.
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}
