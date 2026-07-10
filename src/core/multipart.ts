/**
 * Streaming multipart/form-data encoder (ADR-002, ADR-011).
 *
 * Hand-rolls the multipart body as a web `ReadableStream<Uint8Array>` so file
 * bytes flow chunk-by-chunk from their source (a disk-backed `Blob`, a
 * `Uint8Array`, a caller-provided stream) straight into `fetch` - no part is
 * ever materialized, so upload memory stays flat regardless of file size.
 * Web-standard APIs only (`TextEncoder`, `crypto.getRandomValues`,
 * `ReadableStream`), keeping this edge-safe.
 *
 * The body is built once as an ordered list of `pieces`; each send attempt
 * streams the same pieces again, which is what makes retries possible without
 * buffering: `Uint8Array` and `Blob` pieces re-read for free, and only a
 * one-shot caller `ReadableStream` marks the body non-replayable. Runtimes
 * whose `fetch` cannot stream a request body (see `supportsRequestStreams`)
 * get the same bytes buffered into a single `Blob` instead.
 */

import type { InputFile } from "./files.js";

/** One sendable piece of a multipart body, in wire order. */
export type BodyPiece = Uint8Array | Blob | ReadableStream<Uint8Array>;

export interface MultipartBody {
  boundary: string;
  pieces: ReadonlyArray<BodyPiece>;
  /** False when a one-shot `ReadableStream` piece makes a second send impossible. */
  replayable: boolean;
}

const CRLF = new TextEncoder().encode("\r\n");

/** Random, spec-sized (< 70 chars) boundary; `crypto` is a web global on every target. */
function randomBoundary(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `----NodeTelegramBotApi${hex}`;
}

/** Escape a part name / filename per the WHATWG multipart serialization rules. */
function escapeHeaderValue(value: string): string {
  return value.replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/"/g, "%22");
}

/**
 * Lay out the multipart pieces for the given text fields and file parts.
 * Part headers are encoded eagerly (they are tiny); file bytes stay in their
 * source representation until the body is actually streamed.
 */
export function multipartBody(
  strings: ReadonlyArray<readonly [string, string]>,
  files: ReadonlyArray<readonly [string, InputFile]>,
): MultipartBody {
  const boundary = randomBoundary();
  const enc = new TextEncoder();
  const pieces: BodyPiece[] = [];
  let replayable = true;

  for (const [name, value] of strings) {
    pieces.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeHeaderValue(name)}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const [name, file] of files) {
    const filename = escapeHeaderValue(file.meta?.filename ?? name);
    const blobType = file.data instanceof Blob ? file.data.type : "";
    const contentType = file.meta?.contentType ?? (blobType || "application/octet-stream");
    pieces.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeHeaderValue(name)}"; ` +
          `filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
    );
    if (file.data instanceof ReadableStream) replayable = false;
    pieces.push(file.data);
    pieces.push(CRLF);
  }
  pieces.push(enc.encode(`--${boundary}--\r\n`));

  return { boundary, pieces, replayable };
}

/** Walk the pieces in order, yielding raw chunks (a Blob streams from its store). */
async function* pieceChunks(pieces: ReadonlyArray<BodyPiece>): AsyncGenerator<Uint8Array, void, undefined> {
  for (const piece of pieces) {
    if (piece instanceof Uint8Array) {
      yield piece;
      continue;
    }
    const stream = piece instanceof Blob ? piece.stream() : piece;
    const reader = stream.getReader();
    let finished = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          break;
        }
        yield value;
      }
    } finally {
      // Torn down mid-piece (the consumer cancelled): stop the source too.
      if (!finished) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

/** A fresh stream over the pieces; call once per send attempt. */
export function streamBody(pieces: ReadonlyArray<BodyPiece>): ReadableStream<Uint8Array> {
  const chunks = pieceChunks(pieces);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await chunks.return();
    },
  });
}

/** Fallback for runtimes without request-body streaming: the same bytes, buffered. */
export async function bufferBody(pieces: ReadonlyArray<BodyPiece>): Promise<Blob> {
  return new Response(streamBody(pieces)).blob();
}

let requestStreamsSupported: boolean | undefined;

/**
 * Once-per-process probe: can this runtime's `fetch` send a `ReadableStream`
 * request body? Where bodies must be buffered ahead of time the probe `Request`
 * either throws or stringifies the stream (marking itself with a `text/plain`
 * content-type). Node's undici additionally refuses a stream body unless
 * `duplex: "half"` is present.
 *
 * Bun is excluded by name, not by probe: its `fetch` accepts a stream body but
 * the request then stalls forever against an HTTPS origin (verified on Bun
 * 1.3.x - the same bytes sent as a plain body succeed), which no local probe
 * can detect. Revisit when Bun's streaming uploads are reliable.
 */
export function supportsRequestStreams(): boolean {
  if (requestStreamsSupported === undefined) {
    if ((globalThis as { Bun?: unknown }).Bun !== undefined) {
      requestStreamsSupported = false;
      return requestStreamsSupported;
    }
    try {
      const probe = new Request("http://localhost/", {
        method: "POST",
        body: new ReadableStream(),
        duplex: "half",
      } as RequestInit);
      requestStreamsSupported = !probe.headers.has("content-type");
    } catch {
      requestStreamsSupported = false;
    }
  }
  return requestStreamsSupported;
}
