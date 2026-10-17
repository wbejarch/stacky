import { describe, expect, it, vi } from 'vitest';
import { parseSse, type SseFrame } from './sse';

const encoder = new TextEncoder();

/** Builds a byte stream that emits the given chunks in order. */
function streamOf(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    },
    cancel() {
      onCancel?.();
    },
  });
}

/** Splits `bytes` at the given (sorted, in-range) offsets. */
function splitAt(bytes: Uint8Array, offsets: number[]): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const offset of offsets) {
    chunks.push(bytes.slice(start, offset));
    start = offset;
  }
  chunks.push(bytes.slice(start));
  return chunks;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  for await (const frame of parseSse(stream)) {
    frames.push(frame);
  }
  return frames;
}

async function parseText(text: string): Promise<SseFrame[]> {
  return collect(streamOf([encoder.encode(text)]));
}

/** Small deterministic PRNG so the randomized test is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('parseSse', () => {
  it('parses a simple frame', async () => {
    expect(await parseText('event: token\ndata: {"text":"Hola"}\n\n')).toEqual([
      { event: 'token', data: '{"text":"Hola"}' },
    ]);
  });

  it('uses "message" as the default event name', async () => {
    expect(await parseText('data: hello\n\n')).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('parses several frames in a single chunk', async () => {
    const frames = await parseText('event: token\ndata: a\n\nevent: token\ndata: b\n\nevent: done\ndata: {}\n\n');
    expect(frames).toEqual([
      { event: 'token', data: 'a' },
      { event: 'token', data: 'b' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('removes only one leading space from field values', async () => {
    expect(await parseText('data:  two\n\ndata:none\n\n')).toEqual([
      { event: 'message', data: ' two' },
      { event: 'message', data: 'none' },
    ]);
  });

  it('joins multi-line data fields with "\\n"', async () => {
    expect(await parseText('event: token\ndata: line 1\ndata: line 2\ndata:\ndata: line 4\n\n')).toEqual([
      { event: 'token', data: 'line 1\nline 2\n\nline 4' },
    ]);
  });

  it('handles CRLF and lone CR line endings', async () => {
    expect(await parseText('event: token\r\ndata: a\r\n\r\nevent: done\rdata: {}\r\r')).toEqual([
      { event: 'token', data: 'a' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('handles a CRLF pair split across chunks', async () => {
    const frames = await collect(
      streamOf([encoder.encode('event: token\r'), encoder.encode('\ndata: a\r'), encoder.encode('\n\r'), encoder.encode('\n')]),
    );
    expect(frames).toEqual([{ event: 'token', data: 'a' }]);
  });

  it('ignores comments, unknown fields, id and retry', async () => {
    const text = ': keep-alive\nid: 7\nretry: 1000\nfoo: bar\nevent: token\n: another comment\ndata: x\n\n';
    expect(await parseText(text)).toEqual([{ event: 'token', data: 'x' }]);
  });

  it('does not emit frames that only contain comments or have no data', async () => {
    expect(await parseText(': ping\n\nevent: token\n\n\n\n')).toEqual([]);
  });

  it('parses an error event frame', async () => {
    expect(await parseText('event: error\ndata: {"message":"Algo salió mal"}\n\n')).toEqual([
      { event: 'error', data: '{"message":"Algo salió mal"}' },
    ]);
  });

  it('emits a trailing frame that is not followed by a blank line', async () => {
    expect(await parseText('event: token\ndata: a\n\nevent: done\ndata: {}')).toEqual([
      { event: 'token', data: 'a' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('emits a trailing frame whose last line has no terminator and ends with a lone CR', async () => {
    expect(await parseText('event: done\ndata: {}\r')).toEqual([{ event: 'done', data: '{}' }]);
  });

  it('strips a leading BOM', async () => {
    expect(await parseText('\uFEFFevent: token\ndata: a\n\n')).toEqual([{ event: 'token', data: 'a' }]);
  });

  it('returns no frames for an empty stream', async () => {
    expect(await collect(streamOf([]))).toEqual([]);
  });

  it('parses a stream delivered byte by byte', async () => {
    const bytes = encoder.encode('event: token\r\ndata: a\r\ndata: b\r\n\r\nevent: done\ndata: {}\n\n');
    const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
    expect(await collect(streamOf(chunks))).toEqual([
      { event: 'token', data: 'a\nb' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('decodes a multi-byte UTF-8 character split across chunks', async () => {
    const bytes = encoder.encode('event: token\ndata: {"text":"¡Qué bien 🙂!"}\n\n');
    // Split inside the 4-byte emoji and inside the 2-byte "é".
    const emojiStart = bytes.indexOf(0xf0);
    const eAcute = bytes.indexOf(0xc3);
    expect(emojiStart).toBeGreaterThan(0);
    expect(eAcute).toBeGreaterThan(0);

    const chunks = splitAt(bytes, [eAcute + 1, emojiStart + 1, emojiStart + 2, emojiStart + 3]);
    expect(await collect(streamOf(chunks))).toEqual([{ event: 'token', data: '{"text":"¡Qué bien 🙂!"}' }]);
  });

  it('cancels the underlying stream when the consumer stops early', async () => {
    const onCancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode(`event: token\ndata: ${pulls}\n\n`));
      },
      cancel() {
        onCancel();
      },
    });

    const received: SseFrame[] = [];
    for await (const frame of parseSse(stream)) {
      received.push(frame);
      break;
    }

    expect(received).toEqual([{ event: 'token', data: '1' }]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    // The reader lock was released.
    expect(stream.locked).toBe(false);
  });

  it('cancels the stream and rethrows when the source errors', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: token\ndata: a\n\n'));
        controller.error(new Error('connection lost'));
      },
    });

    const received: SseFrame[] = [];
    await expect(
      (async () => {
        for await (const frame of parseSse(stream)) {
          received.push(frame);
        }
      })(),
    ).rejects.toThrow('connection lost');
  });

  describe('chunking invariance', () => {
    const text =
      ': stream start\r\n' +
      'event: token\r\ndata: {"text":"Hola, ¿cómo estás? 🙂"}\r\n\r\n' +
      'event: token\ndata: línea 1\ndata: línea 2\n\n' +
      'data: sin evento\r\r' +
      'event: token\rdata: ñandú\r\r' +
      'event: done\ndata: {}\n\n' +
      'event: error\ndata: {"message":"fin"}';
    const bytes = encoder.encode(text);

    it('yields the expected frames for the whole stream in one chunk', async () => {
      expect(await collect(streamOf([bytes]))).toEqual([
        { event: 'token', data: '{"text":"Hola, ¿cómo estás? 🙂"}' },
        { event: 'token', data: 'línea 1\nlínea 2' },
        { event: 'message', data: 'sin evento' },
        { event: 'token', data: 'ñandú' },
        { event: 'done', data: '{}' },
        { event: 'error', data: '{"message":"fin"}' },
      ]);
    });

    it('yields the same frames for every two-chunk split point', async () => {
      const expected = await collect(streamOf([bytes]));
      for (let offset = 0; offset <= bytes.length; offset += 1) {
        const frames = await collect(streamOf(splitAt(bytes, [offset])));
        expect(frames, `split at byte ${offset}`).toEqual(expected);
      }
    });

    it('yields the same frames for randomized multi-chunk splits', async () => {
      const expected = await collect(streamOf([bytes]));
      const random = mulberry32(20240607);

      for (let run = 0; run < 300; run += 1) {
        const cuts = 1 + Math.floor(random() * 12);
        const offsets = Array.from({ length: cuts }, () => Math.floor(random() * (bytes.length + 1))).sort(
          (a, b) => a - b,
        );
        const frames = await collect(streamOf(splitAt(bytes, offsets)));
        expect(frames, `offsets ${offsets.join(',')}`).toEqual(expected);
      }
    });
  });
});
