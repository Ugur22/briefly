import type { BriefSourceMime } from '@briefly/contracts';
import { inflateRawSync } from 'node:zlib';

export const PDF: BriefSourceMime = 'application/pdf';
export const DOCX: BriefSourceMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Where an uploaded original lives. The single definition the Storage policies are written against.
export const sourcePath = (workspaceId: string, briefId: string) => `workspaces/${workspaceId}/briefs/${briefId}/original`;

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

type ZipEntry = { name: string; uncompressedSize: number; method: number; compressedSize: number; localOffset: number };

// Reads the zip central directory without inflating anything. Returns null if it isn't a well-formed zip.
function zipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End-of-central-directory record: at least 22 bytes, at most 64 KiB of comment after it.
  for (let eocd = bytes.length - 22; eocd >= Math.max(0, bytes.length - 22 - 0xffff); eocd--) {
    if (view.getUint32(eocd, true) !== 0x06054b50) continue;
    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);
    const entries: ZipEntry[] = [];
    for (let i = 0; i < count; i++) {
      if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return null;
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      entries.push({
        name: ascii(bytes, at + 46, nameLength),
        method: view.getUint16(at + 10, true),
        compressedSize: view.getUint32(at + 20, true),
        uncompressedSize: view.getUint32(at + 24, true),
        localOffset: view.getUint32(at + 42, true),
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }
  return null;
}

export type SniffResult = { mime: BriefSourceMime } | { refused: 'unsupported_type' | 'unreadable' };

// The type comes from the bytes, never from the file name or the client's Content-Type.
// For DOCX the central-directory sizes are a cheap early reject only: they are written by whoever made the
// file, so the real guarantee against zip bombs is the memory-limited, time-limited extraction worker.
export function sniffSourceFile(bytes: Uint8Array, limits = { maxEntries: 2000, maxUncompressedBytes: 50 * 1024 * 1024 }): SniffResult {
  if (ascii(bytes, 0, 5) === '%PDF-') return { mime: PDF };

  if (ascii(bytes, 0, 4) === 'PK\x03\x04') {
    const entries = zipEntries(bytes);
    if (!entries || !entries.some((e) => e.name === 'word/document.xml')) return { refused: 'unsupported_type' };
    const total = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
    if (entries.length > limits.maxEntries || total > limits.maxUncompressedBytes) return { refused: 'unreadable' };
    return { mime: DOCX };
  }

  return { refused: 'unsupported_type' };
}

// The real guarantee against zip bombs: actually inflate every entry against one shared budget, stopping the
// moment it is exceeded. The sizes a zip declares are written by whoever made it; zlib's maxOutputLength is not.
// Runs inside the extraction worker, before the DOCX parser sees the file.
export function inflatesWithin(bytes: Uint8Array, maxBytes: number): boolean {
  const entries = zipEntries(bytes);
  if (!entries) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let budget = maxBytes;
  for (const e of entries) {
    const at = e.localOffset;
    if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) return false;
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    const end = start + e.compressedSize;
    if (end > bytes.length) return false;
    const data = bytes.subarray(start, end);
    if (e.method === 0) {
      budget -= data.length;
    } else if (e.method === 8) {
      if (budget <= 0) return false;
      try {
        budget -= inflateRawSync(data, { maxOutputLength: budget }).length;
      } catch {
        return false; // over budget, or not valid deflate data
      }
    } else {
      return false; // Word only uses stored and deflate
    }
    if (budget < 0) return false;
  }
  return true;
}

const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// Makes extracted text storable and tidy: no NUL or lone surrogates (Postgres can't hold them), no runs of
// blank lines or trailing spaces that PDF layout tends to leave behind.
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\0/g, '')
    .replace(LONE_SURROGATES, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A title from the file name when the user didn't give one: no extension, at most 200 code points.
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.(pdf|docx)$/i, '').replace(/[_]+/g, ' ').trim();
  return [...(base || 'Uploaded brief')].slice(0, 200).join('');
}
