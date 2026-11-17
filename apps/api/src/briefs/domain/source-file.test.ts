import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCX, inflatesWithin, normalizeExtractedText, PDF, sniffSourceFile, sourcePath, titleFromFileName } from './source-file';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/${name}`, import.meta.url)));

describe('sniffSourceFile', () => {
  it('recognises a PDF by its header', () => {
    expect(sniffSourceFile(fixture('brief.pdf'))).toEqual({ mime: PDF });
  });

  it('recognises a DOCX by word/document.xml in the zip directory', () => {
    expect(sniffSourceFile(fixture('brief.docx'))).toEqual({ mime: DOCX });
  });

  it('refuses an executable renamed to .pdf', () => {
    expect(sniffSourceFile(fixture('fake.pdf'))).toEqual({ refused: 'unsupported_type' });
  });

  it('refuses a zip that is not a Word document', () => {
    const zipWithoutDocument = new Uint8Array(readFileSync(new URL('../../../test-fixtures/brief.docx', import.meta.url)));
    // Rename word/document.xml to word/documenX.xml in the central directory.
    const text = Buffer.from(zipWithoutDocument).toString('latin1').replaceAll('word/document.xml', 'word/documenX.xml');
    expect(sniffSourceFile(new Uint8Array(Buffer.from(text, 'latin1')))).toEqual({ refused: 'unsupported_type' });
  });

  it('rejects early a zip whose directory declares a bomb (64 MB from 64 KB)', () => {
    expect(sniffSourceFile(fixture('bomb.docx'))).toEqual({ refused: 'unreadable' });
  });

  it('refuses empty and tiny inputs without throwing', () => {
    expect(sniffSourceFile(new Uint8Array())).toEqual({ refused: 'unsupported_type' });
    expect(sniffSourceFile(new TextEncoder().encode('PK\x03\x04'))).toEqual({ refused: 'unsupported_type' });
  });
});

describe('inflatesWithin', () => {
  const budget = 50 * 1024 * 1024;

  it('passes a real Word file', () => {
    expect(inflatesWithin(fixture('brief.docx'), budget)).toBe(true);
  });

  it('stops a bomb that lies about its sizes, which the directory check lets through', () => {
    expect(sniffSourceFile(fixture('lying-bomb.docx'))).toEqual({ mime: DOCX });
    expect(inflatesWithin(fixture('lying-bomb.docx'), budget)).toBe(false);
  });

  it('stops an honest bomb too', () => {
    expect(inflatesWithin(fixture('bomb.docx'), budget)).toBe(false);
  });

  it('refuses anything that is not a zip', () => {
    expect(inflatesWithin(fixture('brief.pdf'), budget)).toBe(false);
  });
});

describe('normalizeExtractedText', () => {
  it('drops characters Postgres cannot store and tidies layout whitespace', () => {
    expect(normalizeExtractedText('  Spring\0 launch \r\n\r\n\r\n\r\nBudget\uD800 80k  \n')).toBe('Spring launch\n\nBudget 80k');
  });

  it('keeps proper surrogate pairs', () => {
    expect(normalizeExtractedText('Launch 🚀')).toBe('Launch 🚀');
  });
});

describe('titleFromFileName', () => {
  it('strips the extension and underscores', () => {
    expect(titleFromFileName('Spring_launch_brief.PDF')).toBe('Spring launch brief');
  });

  it('falls back when only an extension is left', () => {
    expect(titleFromFileName('.docx')).toBe('Uploaded brief');
  });
});

describe('sourcePath', () => {
  it('matches the shape the Storage policies require', () => {
    expect(sourcePath('ws', 'brief')).toBe('workspaces/ws/briefs/brief/original');
  });
});
