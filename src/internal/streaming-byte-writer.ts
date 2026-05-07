import type { ByteSink } from "./byte-sink.js";

const encoder = new TextEncoder();

export class StreamingByteWriter {
  private offset = 0;

  constructor(private readonly sink: ByteSink) {}

  get size(): number {
    return this.offset;
  }

  writeString(value: string): Promise<void> {
    return this.writeBytes(encoder.encode(value));
  }

  write(value: string): Promise<void> {
    return this.writeString(value);
  }

  async writeLine(value = ""): Promise<void> {
    await this.writeString(`${value}\n`);
  }

  async writeBytes(value: Uint8Array): Promise<void> {
    await this.sink.write(value);
    this.offset += value.length;
  }

  async close(): Promise<void> {
    await this.sink.close();
  }
}
