import type { ByteSink } from "./byte-sink.js";

const encoder = new TextEncoder();

/**
 *
 * A streaming utility class for writing strings and raw bytes directly to a byte sink while tracking the total number of bytes written.
 *
 * @export
 * @class StreamingByteWriter
 */
const FLUSH_THRESHOLD = 64 * 1024;
const RESOLVED = Promise.resolve();

export class StreamingByteWriter {
  private offset = 0;
  private buffered: Uint8Array[] = [];
  private bufferedBytes = 0;

  /**
   * Creates a streaming byte writer backed by the provided sink.
   *
   * @param sink The sink that receives written byte chunks.
   */
  constructor(private readonly sink: ByteSink) {}

  /**
   * Gets the number of bytes written through the writer (including buffered bytes).
   */
  get size(): number {
    return this.offset;
  }

  writeString(value: string): Promise<void> {
    return this.writeBytes(encoder.encode(value));
  }

  write(value: string): Promise<void> {
    return this.writeString(value);
  }

  writeLine(value = ""): Promise<void> {
    return this.writeString(`${value}\n`);
  }

  /**
   * Buffers raw bytes; flushes to the sink only once the buffered total crosses the threshold.
   * Returns a resolved promise on the fast (buffered) path so callers paying the await cost
   * don't trigger an extra microtask round-trip per write.
   */
  writeBytes(value: Uint8Array): Promise<void> {
    if (value.length === 0) {
      return RESOLVED;
    }
    this.buffered.push(value);
    this.bufferedBytes += value.length;
    this.offset += value.length;
    if (this.bufferedBytes < FLUSH_THRESHOLD) {
      return RESOLVED;
    }
    return this.flush();
  }

  async flush(): Promise<void> {
    if (this.bufferedBytes === 0) {
      return;
    }
    const merged = mergeChunks(this.buffered, this.bufferedBytes);
    this.buffered = [];
    this.bufferedBytes = 0;
    await this.sink.write(merged);
  }

  async close(): Promise<void> {
    await this.flush();
    await this.sink.close();
  }
}

function mergeChunks(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  if (chunks.length === 1) {
    return chunks[0]!;
  }
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
