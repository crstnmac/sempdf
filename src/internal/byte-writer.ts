const encoder = new TextEncoder();

export class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  get size(): number {
    return this.length;
  }

  writeString(value: string): void {
    const bytes = encoder.encode(value);
    this.writeBytes(bytes);
  }

  write(value: string): void {
    this.writeString(value);
  }

  writeLine(value = ""): void {
    this.writeString(`${value}\n`);
  }

  writeBytes(value: Uint8Array): void {
    this.chunks.push(value);
    this.length += value.length;
  }

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
