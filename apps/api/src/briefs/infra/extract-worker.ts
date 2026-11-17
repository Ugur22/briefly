// Runs in a worker thread with a memory limit and is terminated on timeout by extract-text.ts, so a hostile
// PDF or zip bomb can only take this thread down, never the API. Only erasable TypeScript here: Node runs this
// file directly in dev and tests, and tsup bundles it as its own entry for production.
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { parentPort, workerData } from 'node:worker_threads';
import { inflatesWithin } from '../domain/source-file.ts';

type Job = { bytes: Uint8Array; mime: string; maxPages: number; maxInflatedBytes: number; maxTextChars: number };
export type WorkerReply = { ok: true; text: string; pages: number } | { ok: false; reason: 'unreadable' | 'too_many_pages' | 'too_long' };

// Oversized text is refused here, so hundreds of MB never cross into the API's (unlimited) heap.
const within = (text: string, maxTextChars: number): WorkerReply | null =>
  text.length > maxTextChars ? { ok: false, reason: 'too_long' } : null;

async function run({ bytes, mime, maxPages, maxInflatedBytes, maxTextChars }: Job): Promise<WorkerReply> {
  try {
    if (mime === 'application/pdf') {
      // unpdf's serverless pdf.js build has no eval path (no `new Function`), so there is no isEvalSupported to turn off.
      const pdf = await getDocumentProxy(bytes);
      if (pdf.numPages > maxPages) return { ok: false, reason: 'too_many_pages' };
      const { text } = await extractText(pdf, { mergePages: true });
      return within(text, maxTextChars) ?? { ok: true, text, pages: pdf.numPages };
    }
    // The heap limit doesn't cover inflated buffers, so cap real decompression before mammoth unzips anything.
    if (!inflatesWithin(bytes, maxInflatedBytes)) return { ok: false, reason: 'unreadable' };
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return within(value, maxTextChars) ?? { ok: true, text: value, pages: 0 };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

parentPort?.postMessage(await run(workerData as Job));
