// Runs the bundled extraction worker (dist/extract-worker.js) on the PDF and DOCX fixtures. The unit tests use the
// .ts source, so only this proves pdf.js and mammoth survived bundling. CI runs it after `build`.
//   node apps/api/scripts/extract-smoke.ts
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

const root = new URL('../', import.meta.url);
const cases = [
  { file: 'brief.pdf', mime: 'application/pdf', expect: 'Spring launch: 5000 test rides in April.' },
  { file: 'brief.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', expect: 'Globex brand refresh teaser' },
  // The inflation cap must hold in the bundle too, not only in the .ts the unit tests run.
  { file: 'lying-bomb.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', expect: null },
];

let failed = 0;
for (const c of cases) {
  const bytes = new Uint8Array(readFileSync(new URL(`test-fixtures/${c.file}`, root)));
  // Never hang CI: a worker that exits without answering, or takes over 15 s, counts as a failure.
  const reply = await new Promise<{ ok: boolean; text?: string }>((resolve) => {
    const worker = new Worker(new URL('dist/extract-worker.js', root), {
      workerData: { bytes, mime: c.mime, maxPages: 100, maxInflatedBytes: 50 * 1024 * 1024, maxTextChars: 200_000 },
    });
    const timer = setTimeout(() => void worker.terminate(), 15_000);
    const done = (r: { ok: boolean; text?: string }) => {
      clearTimeout(timer);
      resolve(r);
      void worker.terminate();
    };
    worker.once('message', done);
    worker.once('error', () => done({ ok: false }));
    worker.once('exit', () => done({ ok: false }));
  });
  const ok = c.expect === null ? reply.ok === false : reply.ok === true && (reply.text ?? '').includes(c.expect);
  console.log(`${ok ? 'ok  ' : 'FAIL'} bundled worker ${c.expect === null ? 'refuses' : 'extracts'} ${c.file}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
