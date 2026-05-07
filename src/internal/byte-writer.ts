const encoder = new TextEncoder();
/**
 *
 * A utility class for writing bytes to an internal buffer. It supports writing strings and raw bytes, and can be converted to a single Uint8Array when needed.
 *
 * @export
 * @class ByteWriter
 */
export class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  /**
   * Gets the number of bytes currently buffered.
   *
   * @returns The number of bytes.
   */
  get size(): number {
    return this.length;
  }

  /**
   * Encodes a string as UTF-8 and appends it to the internal buffer.
   *
   * @param value The value to write or apply.
   */
  writeString(value: string): void {
    const bytes = encoder.encode(value);
    this.writeBytes(bytes);
  }

  /**
   * Appends a string to the internal buffer.
   *
   * @param value The value to write or apply.
   */
  write(value: string): void {
    this.writeString(value);
  }

  /**
   * Appends a string followed by a line feed to the internal buffer.
   *
   * @param value The value to write or apply.
   */
  writeLine(value = ""): void {
    this.writeString(`${value}\n`);
  }

  /**
   * Appends raw bytes to the internal buffer.
   *
   * @param value The value to write or apply.
   */
  writeBytes(value: Uint8Array): void {
    this.chunks.push(value);
    this.length += value.length;
  }

  /**
   * Combines all buffered chunks into a single Uint8Array.
   *
   * @returns The serialized or collected bytes.
   */
  toUint8Array(): Uint8Array {
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}
