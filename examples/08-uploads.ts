/**
 * 08 - Uploading files.
 *
 * Ways to supply file bytes (all stream into the request - memory stays flat
 * no matter the file size):
 *   - `new InputFile(bytes, { filename })` - wrap in-memory bytes (Blob / Uint8Array).
 *     Web-standard, works on every runtime.
 *   - `new InputFile(stream)` / `new InputFile(() => stream)` - stream without buffering.
 *     A bare ReadableStream is one-shot (a failure surfaces instead of retrying); a
 *     factory opens a fresh stream per attempt, so the upload stays retryable.
 *   - `fromPath("./pic.jpg")` - stream a local file from disk (from the `/node` subpath).
 *   - `new MediaGroupBuilder()` - build a `sendMediaGroup` payload; uploaded files are wired
 *     in via `attach://` references for you.
 * A plain string in a file field is always treated as a `file_id` or URL.
 *
 * Run: BOT_TOKEN=123:abc CHAT_ID=12345 bun examples/08-uploads.ts
 */
import { Bot, InputFile, MediaGroupBuilder } from "node-telegram-bot-api";
import { fromPath } from "node-telegram-bot-api/node";

const bot = new Bot(process.env.BOT_TOKEN!);
const chatId = Number(process.env.CHAT_ID ?? "0");

if (chatId !== 0) {
  // 1) In-memory bytes → a tiny text document.
  const bytes = new TextEncoder().encode("hello from a Uint8Array\n");
  await bot.api.sendDocument({
    chat_id: chatId,
    document: new InputFile(bytes, { filename: "hello.txt", contentType: "text/plain" }),
    caption: "Sent from memory",
  });

  // 2) A replayable streaming upload: the factory opens a fresh stream per
  //    attempt, so transport retries still work - use it for any large source
  //    you can re-read (disk, object storage, an HTTP re-request, ...).
  const openStream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello from a stream factory\n"));
        controller.close();
      },
    });
  await bot.api.sendDocument({
    chat_id: chatId,
    document: new InputFile(openStream, { filename: "streamed.txt", contentType: "text/plain" }),
    caption: "Streamed via a factory",
  });

  // 3) A photo by URL (a plain string is a file_id or URL, sent as-is).
  await bot.api.sendPhoto({
    chat_id: chatId,
    photo: "https://picsum.photos/seed/ntba/600/400",
    caption: "Sent by URL",
  });

  // 4) A file from disk via `fromPath` (uncomment once you have a real path):
  //    const local = await fromPath("./avatar.png");
  //    await bot.api.sendPhoto({ chat_id: chatId, photo: local });
  void fromPath; // referenced so the import is exercised in the example

  // 5) An album. `new MediaGroupBuilder().build()` mints attach:// refs for any InputFile.
  const album = new MediaGroupBuilder()
    .photo({ media: "https://picsum.photos/seed/a/400", caption: "First" })
    .photo({ media: "https://picsum.photos/seed/b/400" })
    .photo({ media: new InputFile(bytes, { filename: "note.txt" }) }) // mixes uploads + URLs freely
    .build();
  await bot.api.sendMediaGroup({ chat_id: chatId, media: album });

  console.log("Uploads sent.");
} else {
  console.log("Set CHAT_ID to run the uploads.");
}
