/**
 * `fromPath` - wrap a local file as an `InputFile` (ADR-006, §6.4).
 *
 * The sole Node-only file-input helper. The core `InputFile` wraps web-standard
 * data only (no `fs`, no path-guessing), so reading from disk lives here, under
 * the one folder allowed to import `node:*`.
 *
 * Prefers `fs.openAsBlob` (Node >= 19.8, Bun, Deno): a disk-backed `Blob` whose
 * bytes stream from disk during the send, so upload memory stays flat no matter
 * the file size, and a retry can re-read it. Runtimes without it fall back to
 * reading the whole file into memory (`readFile` returns a `Buffer`, which is a
 * `Uint8Array` - accepted by `InputFile` directly, no copy).
 */

import * as fs from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { InputFile } from "../core/files.js";

/**
 * Wrap the file at `path` as an `InputFile`, streaming it from disk where the
 * runtime allows. The default filename is the path's basename; pass
 * `meta.filename` / `meta.contentType` to override.
 */
export async function fromPath(path: string, meta?: { filename?: string; contentType?: string }): Promise<InputFile> {
  // Feature-detected (not a named import: that would throw at load on Node < 19.8).
  const data = typeof fs.openAsBlob === "function" ? await fs.openAsBlob(path) : await readFile(path);
  return new InputFile(data, {
    filename: meta?.filename ?? basename(path),
    contentType: meta?.contentType,
  });
}
