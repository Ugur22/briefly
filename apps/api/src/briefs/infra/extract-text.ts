import { BRIEF_BODY_MAX, type BriefSourceMime } from '@briefly/contracts';
import { Worker } from 'node:worker_threads';
import { normalizeExtractedText } from '../domain/source-file';
import type { WorkerReply } from './extract-worker';

export type Extraction =
  | { kind: 'ok'; text: string; pages: number; ms: number }
  | { kind: 'no_text' | 'too_long' | 'unreadable' | 'busy' };

export type ExtractOptions = {
  timeoutMs: number;
  maxConcurrent: number;
  maxPages: number;
  memoryMb: number;
  // The heap limit above doesn't cover array buffers, and pdf.js keeps decoded streams in them: a 600 KB PDF
  // reached 1.3 GB of process memory without this. Checked every memoryCheckMs; the overshoot was ~35 MB.
  maxExternalMb: number;
  memoryCheckMs: number;
  maxInflatedBytes: number;
  // Raw text may shrink a little when normalised, so the worker's cut-off leaves room above the brief limit.
  maxTextChars: number;
  workerUrl: URL;
};

// Dev and tests run the .ts source directly (Node strips types); the bundle ships extract-worker.js next to main.js.
const defaultWorkerUrl = new URL(import.meta.url.endsWith('.ts') ? './extract-worker.ts' : './extract-worker.js', import.meta.url);

export const defaultExtractOptions: ExtractOptions = {
  timeoutMs: 10_000,
  maxConcurrent: 2,
  maxPages: 100,
  memoryMb: 256,
  maxExternalMb: 128,
  memoryCheckMs: 25,
  maxInflatedBytes: 50 * 1024 * 1024,
  maxTextChars: BRIEF_BODY_MAX * 4,
  workerUrl: defaultWorkerUrl,
};

export type TextExtractor = (bytes: Uint8Array, mime: BriefSourceMime) => Promise<Extraction>;

// Each file gets a fresh worker that is killed when it overruns its time, heap or array-buffer memory; a slot
// limit keeps a burst of uploads from exhausting the machine (callers get 'busy' and the user can retry).
export function createTextExtractor(opts: ExtractOptions = defaultExtractOptions): TextExtractor {
  let running = 0;

  return async (bytes, mime) => {
    if (running >= opts.maxConcurrent) return { kind: 'busy' };
    running++;
    const started = performance.now();
    try {
      const reply = await new Promise<WorkerReply | null>((resolve) => {
        const worker = new Worker(opts.workerUrl, {
          workerData: { bytes, mime, maxPages: opts.maxPages, maxInflatedBytes: opts.maxInflatedBytes, maxTextChars: opts.maxTextChars },
          resourceLimits: { maxOldGenerationSizeMb: opts.memoryMb, maxYoungGenerationSizeMb: 32 },
        });
        const kill = () => {
          clearTimeout(timer);
          clearInterval(watch);
          void worker.terminate().then(() => resolve(null));
        };
        const timer = setTimeout(kill, opts.timeoutMs);
        const watch = setInterval(() => {
          // Rejects once the worker has exited, which settle handles.
          worker.getHeapStatistics().then((s) => {
            if (s.external_memory > opts.maxExternalMb * 1024 * 1024) kill();
          }, () => {});
        }, opts.memoryCheckMs);
        const settle = (value: WorkerReply | null) => {
          clearTimeout(timer);
          clearInterval(watch);
          resolve(value);
          void worker.terminate();
        };
        worker.once('message', (m: WorkerReply) => settle(m));
        worker.once('error', () => settle(null));
        worker.once('exit', () => settle(null));
      });

      if (reply && !reply.ok && reply.reason === 'too_long') return { kind: 'too_long' };
      if (!reply || !reply.ok) return { kind: 'unreadable' };
      const text = normalizeExtractedText(reply.text);
      if (text === '') return { kind: 'no_text' };
      if ([...text].length > BRIEF_BODY_MAX) return { kind: 'too_long' };
      return { kind: 'ok', text, pages: reply.pages, ms: Math.round(performance.now() - started) };
    } finally {
      running--;
    }
  };
}
