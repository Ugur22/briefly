import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createDeflate } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DOCX, PDF } from '../domain/source-file';
import { createTextExtractor, defaultExtractOptions } from './extract-text';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/${name}`, import.meta.url)));
const extract = createTextExtractor();

// One page whose content stream inflates from ~260 KB to `mb` MB of spaces. Deflated in chunks, so the test
// process never holds the inflated size itself.
async function pdfBomb(mb: number): Promise<Uint8Array> {
  const chunk = Buffer.alloc(1024 * 1024, 0x20);
  const parts: Buffer[] = [];
  const deflate = createDeflate({ level: 9 });
  deflate.on('data', (b: Buffer) => parts.push(b));
  await pipeline(
    (function* () {
      for (let i = 0; i < mb; i++) yield chunk;
    })(),
    deflate,
  );
  const stream = Buffer.concat(parts);
  const head =
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
    `4 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`;
  const tail = '\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';
  return new Uint8Array(Buffer.concat([Buffer.from(head, 'latin1'), stream, Buffer.from(tail, 'latin1')]));
}

describe('text extraction (real worker, real libraries)', () => {
  it('reads the text of a PDF', async () => {
    const r = await extract(fixture('brief.pdf'), PDF);

    expect(r).toMatchObject({ kind: 'ok', pages: 1 });
    expect(r.kind === 'ok' && r.text).toBe('Spring launch: 5000 test rides in April.\nBudget EUR 80k.');
  });

  it('reads the text of a DOCX', async () => {
    const r = await extract(fixture('brief.docx'), DOCX);

    expect(r.kind === 'ok' && r.text).toBe('Globex brand refresh teaser\n\nLaunch 1 June. LinkedIn and trade press.');
  });

  it('says a scanned PDF has no text instead of creating an empty brief', async () => {
    expect(await extract(fixture('scanned.pdf'), PDF)).toEqual({ kind: 'no_text' });
  });

  // Inflation stops at the budget inside the worker (see inflatesWithin), before mammoth unzips anything.
  it('stops a DOCX zip bomb that lies about its sizes', async () => {
    expect(await extract(fixture('lying-bomb.docx'), DOCX)).toEqual({ kind: 'unreadable' });
  });

  // Without the array-buffer limit this bomb inflates completely and comes back as no_text, so unreadable proves
  // the worker was killed. The heap limit alone never fires: pdf.js holds decoded streams outside the heap.
  it('kills a worker whose PDF inflates past the array-buffer limit', async () => {
    const bomb = await pdfBomb(256);
    // A slow machine must not pass this through the timeout instead.
    const patient = createTextExtractor({ ...defaultExtractOptions, timeoutMs: 60_000 });

    expect(await patient(bomb, PDF)).toEqual({ kind: 'unreadable' });
  });

  it('can see a worker’s array-buffer memory, which the limit above depends on', async () => {
    const worker = new Worker('setInterval(() => {}, 1000)', { eval: true });
    try {
      await once(worker, 'online');
      expect((await worker.getHeapStatistics()).external_memory).toEqual(expect.any(Number));
    } finally {
      await worker.terminate();
    }
  });

  it('refuses oversized text inside the worker, before it reaches the API process', async () => {
    const tight = createTextExtractor({ ...defaultExtractOptions, maxTextChars: 10 });

    expect(await tight(fixture('brief.pdf'), PDF)).toEqual({ kind: 'too_long' });
  });

  it('calls bytes that only claim to be a PDF unreadable', async () => {
    expect(await extract(new TextEncoder().encode('%PDF-1.4 but nothing else'), PDF)).toEqual({ kind: 'unreadable' });
  });

  it('refuses a PDF with more pages than allowed', async () => {
    const strict = createTextExtractor({ ...defaultExtractOptions, maxPages: 0 });

    expect(await strict(fixture('brief.pdf'), PDF)).toEqual({ kind: 'unreadable' });
  });

  it('kills a worker that runs too long and reports unreadable', async () => {
    const hang = join(tmpdir(), `briefly-hang-${process.pid}.mjs`);
    writeFileSync(hang, 'while (true) {}');
    const slow = createTextExtractor({ ...defaultExtractOptions, timeoutMs: 200, workerUrl: pathToFileURL(hang) });

    const started = Date.now();
    expect(await slow(fixture('brief.pdf'), PDF)).toEqual({ kind: 'unreadable' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('answers busy when every slot is taken', async () => {
    const hang = join(tmpdir(), `briefly-hang2-${process.pid}.mjs`);
    writeFileSync(hang, 'while (true) {}');
    const one = createTextExtractor({ ...defaultExtractOptions, maxConcurrent: 1, timeoutMs: 300, workerUrl: pathToFileURL(hang) });

    const first = one(fixture('brief.pdf'), PDF);
    expect(await one(fixture('brief.pdf'), PDF)).toEqual({ kind: 'busy' });
    await first;
  });
});
