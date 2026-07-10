import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fromPath } from "../../src/node/from-path.js";

describe("fromPath", () => {
  test("wraps the file as a replayable stream factory (flat memory, retry-safe)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ntba-from-path-"));
    const path = join(dir, "fixture.txt");
    await writeFile(path, "streamed from disk");
    try {
      const file = await fromPath(path, { contentType: "text/plain" });
      assert.strictEqual(file.meta?.filename, basename(path));
      assert.strictEqual(file.meta?.contentType, "text/plain");
      assert.strictEqual(typeof file.data, "function");
      if (typeof file.data !== "function") return; // narrowed above; satisfies TS
      // Each factory call re-reads the file - what makes a retry possible.
      assert.strictEqual(await new Response(await file.data()).text(), "streamed from disk");
      assert.strictEqual(await new Response(await file.data()).text(), "streamed from disk");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("a missing path fails at fromPath, not mid-request", async () => {
    await assert.rejects(fromPath("/no/such/file.bin"), /ENOENT/);
  });
});
