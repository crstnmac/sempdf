export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface NodeWritableLike {
  write(chunk: Uint8Array, callback?: (error?: Error | null) => void): boolean;
  once(event: "drain", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  off?(event: "drain", listener: () => void): unknown;
  off?(event: "error", listener: (error: Error) => void): unknown;
  end(callback?: (error?: Error | null) => void): unknown;
}

export class BufferSink implements ByteSink {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  private closed = false;

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("Cannot write to a closed BufferSink.");
    }

    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  collect(): Uint8Array {
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

export class NodeStreamSink implements ByteSink {
  constructor(private readonly stream: NodeWritableLike) {}

  write(chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        this.stream.off?.("drain", onDrain);
        this.stream.off?.("error", onError);
      };
      const settleResolve = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };
      const settleReject = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const onDrain = (): void => settleResolve();
      const onError = (error: Error): void => settleReject(error);

      this.stream.once("error", onError);
      const ready = this.stream.write(chunk, (error?: Error | null) => {
        if (error) {
          settleReject(error);
          return;
        }

        if (ready) {
          settleResolve();
        }
      });

      if (!ready) {
        this.stream.once("drain", onDrain);
      }
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

export class WebStreamSink implements ByteSink {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;

  constructor(stream: WritableStream<Uint8Array>) {
    this.writer = stream.getWriter();
  }

  async write(chunk: Uint8Array): Promise<void> {
    await this.writer.ready;
    await this.writer.write(chunk);
  }

  async close(): Promise<void> {
    await this.writer.close();
  }
}
