// Repro for https://github.com/oven-sh/bun/issues/33918
// fetch() with a ReadableStream request body vs plain bytes, HTTP vs HTTPS.
//
// Plain JS, zero dependencies. Run it with BOTH runtimes and compare:
//   bun  bun-stream-repro.mjs
//   node bun-stream-repro.mjs        (Node >= 18)
//
// Interpreting results:
//   - all four lines "HTTP 200"          -> streaming works in this environment
//   - only "https stream" times out      -> the bug (Bun 1.3.14 in a sandbox
//     behind an HTTP CONNECT proxy showed exactly this; Node through the SAME
//     proxy passed all four, so it is Bun-specific either way)
// Run once from a network WITHOUT a proxy and once behind one (set
// HTTPS_PROXY) to tell whether the stall is proxy-conditional.

const runtime = globalThis.Bun
  ? `bun ${globalThis.Bun.version}`
  : `node ${globalThis.process?.version ?? "?"}`;
const proxy =
  globalThis.process?.env?.HTTPS_PROXY ?? globalThis.process?.env?.https_proxy ?? "(none)";
console.log(`runtime: ${runtime}  https_proxy: ${proxy}\n`);

const bytes = new TextEncoder().encode("hello=world");

for (const url of ["https://postman-echo.com/post", "http://postman-echo.com/post"]) {
  for (const mode of ["plain ", "stream"]) {
    const body =
      mode === "plain "
        ? bytes
        : new ReadableStream({
            start(c) {
              c.enqueue(bytes);
              c.close();
            },
          });
    const t = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        duplex: "half", // required by Node for stream bodies; Bun ignores it
        signal: AbortSignal.timeout(15_000),
      });
      await res.text();
      console.log(`${url} ${mode} -> HTTP ${res.status} in ${Date.now() - t}ms`);
    } catch (err) {
      console.log(`${url} ${mode} -> ${err.name}: ${err.message} after ${Date.now() - t}ms`);
    }
  }
}
