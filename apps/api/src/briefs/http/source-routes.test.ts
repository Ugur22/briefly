import { BriefResponse, type Brief, type WorkspaceRole } from '@briefly/contracts';
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app';
import type { IdentityRepo } from '../../identity/infra/identity-repo';
import { DbError } from '../../platform/db-error';
import { loadConfig } from '../../platform/config';
import { signToken, testEnv, testJwks } from '../../test/fixtures';
import type { Extraction } from '../infra/extract-text';
import type { BriefsRepo } from '../infra/briefs-repo';
import type { SourceStorage } from '../infra/source-storage';
import { contentDisposition } from './source-routes';

const wsA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const briefId = 'b1ef0000-0000-4000-8000-000000000001';
const fixture = (name: string) => readFileSync(new URL(`../../../test-fixtures/${name}`, import.meta.url));
const pdfBytes = fixture('brief.pdf');

const stored: Brief = {
  id: briefId,
  workspaceId: wsA,
  title: 'Spring launch brief',
  status: 'draft',
  version: 1,
  body: 'Spring launch',
  updatedAt: '2026-11-18T09:00:00.000Z',
  createdAt: '2026-11-18T09:00:00.000Z',
  source: { name: 'Spring launch brief.pdf', mime: 'application/pdf', size: pdfBytes.length },
};

let role: WorkspaceRole = 'editor';
let extraction: Extraction = { kind: 'ok', text: 'Spring launch', pages: 1, ms: 5 };
const briefs = {
  list: vi.fn(),
  get: vi.fn(async (ws: string, id: string): Promise<Brief | null> => (ws === wsA && id === briefId ? stored : null)),
  create: vi.fn<BriefsRepo['create']>(async () => stored),
  update: vi.fn(),
  remove: vi.fn(),
} satisfies BriefsRepo;
const sources = {
  put: vi.fn<SourceStorage['put']>(async () => 'ok'),
  get: vi.fn(async (): Promise<Uint8Array | null> => new Uint8Array(pdfBytes)),
  remove: vi.fn(async () => true),
} satisfies SourceStorage;
const extract = vi.fn(async () => extraction);
const identity = (): IdentityRepo => ({
  provisionMe: vi.fn(),
  listWorkspaces: vi.fn(),
  findWorkspace: async (id) => (id === wsA ? { id: wsA, name: 'A', role } : null),
});

function multipartBody(file?: { name: string; bytes: Buffer }, title?: string) {
  const boundary = '----briefly-test';
  const chunks: Buffer[] = [];
  if (title !== undefined) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`));
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    chunks.push(file.bytes, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('upload and download of brief originals', () => {
  const app = buildApp(loadConfig(testEnv), { jwks: testJwks, repoFor: identity, briefsFor: () => briefs, sourcesFor: () => sources, extract });
  afterAll(() => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    role = 'editor';
    extraction = { kind: 'ok', text: 'Spring launch', pages: 1, ms: 5 };
  });

  const upload = async (file?: { name: string; bytes: Buffer }, title?: string) => {
    const { payload, contentType } = multipartBody(file, title);
    return app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsA}/briefs/upload`,
      payload,
      headers: { authorization: `Bearer ${await signToken()}`, 'content-type': contentType },
    });
  };

  it('stores the original, then creates the brief under the same id from the extracted text', async () => {
    const res = await upload({ name: 'Spring_launch_brief.pdf', bytes: pdfBytes });

    expect(res.statusCode).toBe(201);
    expect(BriefResponse.parse(res.json()).brief.source?.mime).toBe('application/pdf');
    const [path, bytes, mime] = sources.put.mock.calls[0] as unknown as [string, Uint8Array, string];
    const [ws, input, uploaded] = briefs.create.mock.calls[0] as unknown as [string, unknown, { id: string; source: unknown }];
    expect(path).toBe(`workspaces/${wsA}/briefs/${uploaded.id}/original`);
    expect(Buffer.from(bytes).equals(pdfBytes)).toBe(true);
    expect(mime).toBe('application/pdf');
    expect(ws).toBe(wsA);
    expect(input).toEqual({ title: 'Spring launch brief', body: 'Spring launch' });
    expect(uploaded.source).toEqual({ name: 'Spring_launch_brief.pdf', mime: 'application/pdf', size: pdfBytes.length });
  });

  it('uses the title the user gave', async () => {
    await upload({ name: 'x.pdf', bytes: pdfBytes }, 'Q3 launch');

    expect(briefs.create.mock.calls[0]?.[1]).toEqual({ title: 'Q3 launch', body: 'Spring launch' });
  });

  it('refuses a read-only role before reading the file', async () => {
    role = 'approver';

    const res = await upload({ name: 'x.pdf', bytes: pdfBytes });

    expect(res.statusCode).toBe(403);
    expect(extract).not.toHaveBeenCalled();
    expect(sources.put).not.toHaveBeenCalled();
  });

  it.each([
    ['no file', undefined, 400, 'missing_file'],
    ['an executable renamed to .pdf', { name: 'brief.pdf', bytes: fixture('fake.pdf') }, 415, 'unsupported_type'],
    ['a zip bomb posing as DOCX', { name: 'brief.docx', bytes: fixture('bomb.docx') }, 422, 'unreadable'],
    ['a file over 10 MB', { name: 'big.pdf', bytes: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]) }, 413, 'too_large'],
  ] as const)('refuses %s', async (_, file, status, error) => {
    const res = await upload(file);

    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error });
    expect(sources.put).not.toHaveBeenCalled();
  });

  it.each([
    ['no_text', 422],
    ['too_long', 422],
    ['unreadable', 422],
    ['busy', 503],
  ] as const)('reports extraction result %s as %i, storing nothing', async (kind, status) => {
    extraction = { kind };

    const res = await upload({ name: 'x.pdf', bytes: pdfBytes });

    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: kind });
    expect(sources.put).not.toHaveBeenCalled();
  });

  it.each([
    ['a request that is not multipart', 'application/json', '{}'],
    ['multipart without a boundary', 'multipart/form-data', '--x\r\n'],
    ['a truncated multipart body', 'multipart/form-data; boundary=b', '--b\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n\r\n%PDF-'],
  ])('answers %s with 400 missing_file, not a server error', async (_, contentType, payload) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsA}/briefs/upload`,
      payload,
      headers: { authorization: `Bearer ${await signToken()}`, 'content-type': contentType },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'missing_file' });
  });

  it('answers a malformed workspace id in the URL with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/not-a-uuid/briefs/upload',
      payload: multipartBody({ name: 'x.pdf', bytes: pdfBytes }).payload,
      headers: { authorization: `Bearer ${await signToken()}`, 'content-type': multipartBody().contentType },
    });

    expect(res.statusCode).toBe(400);
  });

  it('strips bidi overrides so a file name cannot disguise its extension', async () => {
    await upload({ name: 'brief\u202Efdp.exe', bytes: pdfBytes });

    expect((briefs.create.mock.calls[0]?.[2] as { source: { name: string } }).source.name).toBe('brieffdp.exe');
  });

  it('shortens an over-long title instead of refusing the file', async () => {
    await upload({ name: 'x.pdf', bytes: pdfBytes }, 't'.repeat(300));

    expect((briefs.create.mock.calls[0]?.[1] as { title: string }).title).toHaveLength(200);
  });

  it('refuses with 403 when Storage refuses the upload, writing no row', async () => {
    sources.put.mockResolvedValueOnce('forbidden');

    const res = await upload({ name: 'x.pdf', bytes: pdfBytes });

    expect(res.statusCode).toBe(403);
    expect(briefs.create).not.toHaveBeenCalled();
  });

  it('removes the stored original when the brief row cannot be written', async () => {
    briefs.create.mockRejectedValueOnce(new DbError('briefs.create', '42501'));

    const res = await upload({ name: 'x.pdf', bytes: pdfBytes });

    expect(res.statusCode).toBe(403);
    expect(sources.remove).toHaveBeenCalledWith(sources.put.mock.calls[0]?.[0]);
  });

  it('serves the original as an inert download with the type recorded in the database', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsA}/briefs/${briefId}/source`,
      headers: { authorization: `Bearer ${await signToken()}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(pdfBytes)).toBe(true);
    expect(res.headers).toMatchObject({
      'content-type': 'application/pdf',
      'content-disposition': contentDisposition('Spring launch brief.pdf'),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'content-security-policy': 'sandbox',
    });
  });

  it('answers 404 for a brief without an original, or one hidden by RLS', async () => {
    briefs.get.mockResolvedValueOnce({ ...stored, source: null });
    const headers = { authorization: `Bearer ${await signToken()}` };

    const noSource = await app.inject({ method: 'GET', url: `/api/workspaces/${wsA}/briefs/${briefId}/source`, headers });
    sources.get.mockResolvedValueOnce(null);
    const hidden = await app.inject({ method: 'GET', url: `/api/workspaces/${wsA}/briefs/${briefId}/source`, headers });

    expect(noSource.statusCode).toBe(404);
    expect(hidden.statusCode).toBe(404);
  });
});

describe('contentDisposition', () => {
  it('cannot be broken out of by quotes or line breaks, and keeps the UTF-8 name', () => {
    const header = contentDisposition('Brief "Q3"\\\r\nSet-Cookie: x.pdf');

    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="Brief _Q3___');
    expect(contentDisposition('Lancering é.pdf')).toContain("filename*=UTF-8''Lancering%20%C3%A9.pdf");
    expect(contentDisposition("Q3 (final)'s*.pdf")).toContain("filename*=UTF-8''Q3%20%28final%29%27s%2A.pdf");
  });
});
