import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOCX, PDF } from '../domain/source-file';
import { createTextExtractor, defaultExtractOptions } from './extract-text';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/${name}`, import.meta.url)));
const extract = createTextExtractor();

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
