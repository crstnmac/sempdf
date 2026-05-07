/**
 * Streaming output contract implemented by sinks that receive generated PDF byte chunks.
 */
export interface ByteSink {
  /** Writes a generated PDF byte chunk to the sink. */
  write(chunk: Uint8Array): Promise<void>;
  /** Closes the sink after all chunks have been written. */
  close(): Promise<void>;
}

/**
 * Minimal writable-stream shape accepted by NodeStreamSink.
 */
export interface NodeWritableLike {
  /** Writes a byte chunk and reports whether the stream is ready for more data. */
  write(chunk: Uint8Array, callback?: (error?: Error | null) => void): boolean;
  /** Registers a one-time listener for the drain event. */
  once(event: "drain", listener: () => void): unknown;
  /** Registers a one-time listener for the error event. */
  once(event: "error", listener: (error: Error) => void): unknown;
  /** Removes a previously registered drain listener. */
  off?(event: "drain", listener: () => void): unknown;
  /** Removes a previously registered error listener. */
  off?(event: "error", listener: (error: Error) => void): unknown;
  /** Ends the writable stream. */
  end(callback?: (error?: Error | null) => void): unknown;
}

/**
 *
 * An in-memory byte sink that collects streamed PDF output chunks and exposes them as a single Uint8Array when needed.
 */
export class BufferSink implements ByteSink {
  /** Chunks. */
  private readonly chunks: Uint8Array[] = [];
  /** Length. */
  private length = 0;
  /** Closed. */
  private closed = false;

  /**
   * Stores a streamed byte chunk in memory.
   *
   * @param chunk The byte chunk to write.
   */
  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("Cannot write to a closed BufferSink.");
    }

    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  /**
   * Marks the sink as closed so no more chunks can be written.
   */
  async close(): Promise<void> {
    this.closed = true;
  }

  /**
   * Combines all collected chunks into a single Uint8Array.
   *
   * @returns The collected bytes.
   */
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

/**
 *
 * A byte sink adapter for writing generated PDF output to a Node.js writable stream while respecting backpressure and stream errors.
 */
export class NodeStreamSink implements ByteSink {
  /**
   * Creates a byte sink for a Node.js writable stream.
   *
   * @param stream The writable stream that receives byte chunks.
   */
  constructor(private readonly stream: NodeWritableLike) {}

  /**
   * Writes a byte chunk to the Node.js stream and waits for backpressure when needed.
   *
   * @param chunk The byte chunk to write.
   */
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

  /**
   * Ends the Node.js stream.
   */
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

/**
 *
 * A byte sink adapter for writing generated PDF output to a Web WritableStream through its default writer.
 */
export class WebStreamSink implements ByteSink {
  /** Writer. */
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;

  /**
   * Creates a byte sink for a Web WritableStream.
   *
   * @param stream The writable stream that receives byte chunks.
   */
  constructor(stream: WritableStream<Uint8Array>) {
    this.writer = stream.getWriter();
  }

  /**
   * Writes a byte chunk through the stream writer.
   *
   * @param chunk The byte chunk to write.
   */
  async write(chunk: Uint8Array): Promise<void> {
    await this.writer.ready;
    await this.writer.write(chunk);
  }

  /**
   * Closes the stream writer.
   */
  async close(): Promise<void> {
    await this.writer.close();
  }
}
