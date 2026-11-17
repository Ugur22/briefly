import multipart from '@fastify/multipart';
import { ApiErrorBody, BRIEF_FILE_MAX_BYTES, BRIEF_TITLE_MAX, BriefCreate, BriefParams, BriefResponse, WorkspaceParams, type UploadError } from '@briefly/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { IdentityRepo } from '../../identity/infra/identity-repo';
import { requireAuth } from '../../platform/auth';
import { briefPermissions } from '../domain/permissions';
import { briefActions } from '../domain/workflow';
import { sniffSourceFile, sourcePath, titleFromFileName } from '../domain/source-file';
import type { BriefsRepo } from '../infra/briefs-repo';
import type { TextExtractor } from '../infra/extract-text';
import type { SourceStorage } from '../infra/source-storage';

export type SourceRoutesOptions = {
  identityFor: (accessToken: string) => IdentityRepo;
  briefsFor: (accessToken: string) => BriefsRepo;
  sourcesFor: (accessToken: string) => SourceStorage;
  extract: TextExtractor;
};

const STATUS: Record<UploadError, number> = {
  missing_file: 400,
  too_large: 413,
  unsupported_type: 415,
  unreadable: 422,
  no_text: 422,
  too_long: 422,
  busy: 503,
};
const refuse = (reply: FastifyReply, error: UploadError) => reply.code(STATUS[error]).send({ error });

const MULTIPART_TOO_LARGE = new Set(['FST_REQ_FILE_TOO_LARGE', 'FST_FILES_LIMIT', 'FST_PARTS_LIMIT', 'FST_FIELDS_LIMIT']);

// The user's file name is kept for display and download only: no path, no control characters, bounded length.
const cleanFileName = (name: string) => {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Also drops C1 controls and bidi overrides, which can make "brief\u202Efdp.exe" display as "briefexe.pdf".
  const hidden = (c: string) => {
    const code = c.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
  };
  const printable = [...base].filter((c) => !hidden(c)).join('');
  const clean = [...printable.trim()].slice(0, 255).join('');
  return clean || 'brief';
};

// attachment + an ASCII fallback + RFC 5987 UTF-8 name; quotes, backslashes and line breaks can't break out.
export const contentDisposition = (name: string) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

async function readUpload(req: FastifyRequest): Promise<{ bytes: Uint8Array; fileName: string; title?: string } | UploadError> {
  let file: { bytes: Uint8Array; fileName: string } | undefined;
  let title: string | undefined;
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') file = { bytes: new Uint8Array(await part.toBuffer()), fileName: part.filename };
      else if (part.type === 'file') await part.toBuffer();
      else if (part.fieldname === 'title' && typeof part.value === 'string') title = part.value;
    }
  } catch (err) {
    if (MULTIPART_TOO_LARGE.has((err as { code?: string }).code ?? '')) return 'too_large';
    // Not multipart, no boundary, truncated: there is no usable file, which is a 400, not a server error.
    req.log.info({ code: (err as { code?: string }).code }, 'unreadable multipart body');
    return 'missing_file';
  }
  if (!file || file.bytes.length === 0) return 'missing_file';
  return { ...file, ...(title?.trim() ? { title } : {}) };
}

export const sourceRoutes: FastifyPluginAsyncZod<SourceRoutesOptions> = async (app, { identityFor, briefsFor, sourcesFor, extract }) => {
  await app.register(multipart, {
    limits: { fileSize: BRIEF_FILE_MAX_BYTES, files: 1, fields: 1, parts: 2, fieldSize: 4096 },
  });

  app.post(
    '/workspaces/:wsId/briefs/upload',
    {
      schema: {
        params: WorkspaceParams,
        // Error bodies are plain { error } here: a 400 can also come from validating the URL, not just the upload.
        response: { 201: BriefResponse, 400: ApiErrorBody, 403: ApiErrorBody, 404: ApiErrorBody, 413: ApiErrorBody, 415: ApiErrorBody, 422: ApiErrorBody, 503: ApiErrorBody },
      },
    },
    async (req, reply) => {
      const token = requireAuth(req).token;
      const ws = await identityFor(token).findWorkspace(req.params.wsId);
      if (!ws) return reply.code(404).send({ error: 'not found' });
      const can = briefPermissions(ws.role);
      if (!can.create) return reply.code(403).send({ error: 'forbidden' });

      const upload = await readUpload(req);
      if (typeof upload === 'string') return refuse(reply, upload);

      const sniffed = sniffSourceFile(upload.bytes);
      if ('refused' in sniffed) return refuse(reply, sniffed.refused);

      const extracted = await extract(upload.bytes, sniffed.mime);
      if (extracted.kind !== 'ok') return refuse(reply, extracted.kind);

      const fileName = cleanFileName(upload.fileName);
      const title = [...(upload.title ?? titleFromFileName(fileName)).trim()].slice(0, BRIEF_TITLE_MAX).join('');
      const input = BriefCreate.safeParse({ title, body: extracted.text });
      if (!input.success) return refuse(reply, 'unreadable');

      // The original goes up first under a new brief id, then the row is written; if the row fails, the object
      // is an orphan the editor is allowed to remove (see the Storage delete policy), so remove it.
      const id = randomUUID();
      const path = sourcePath(ws.id, id);
      const sources = sourcesFor(token);
      if ((await sources.put(path, upload.bytes, sniffed.mime)) === 'forbidden') return reply.code(403).send({ error: 'forbidden' });

      try {
        const brief = await briefsFor(token).create(ws.id, input.data, { id, source: { name: fileName, mime: sniffed.mime, size: upload.bytes.length } });
        req.log.info({ size: upload.bytes.length, mime: sniffed.mime, pages: extracted.pages, ms: extracted.ms }, 'brief uploaded');
        return reply.code(201).send({ brief, permissions: briefActions(ws.role, brief.status) });
      } catch (err) {
        const removed = await sources.remove(path).catch((cleanupErr: unknown) => {
          req.log.warn({ err: cleanupErr }, 'orphaned upload not removed');
          return true;
        });
        if (!removed) req.log.warn('orphaned upload not visible for removal');
        throw err;
      }
    },
  );

  app.get('/workspaces/:wsId/briefs/:briefId/source', { schema: { params: BriefParams, response: { 200: z.custom<Buffer>((v) => Buffer.isBuffer(v)), 404: ApiErrorBody } } }, async (req, reply) => {
    const token = requireAuth(req).token;
    const { wsId, briefId } = req.params;
    const [ws, brief] = await Promise.all([identityFor(token).findWorkspace(wsId), briefsFor(token).get(wsId, briefId)]);
    if (!ws || !brief?.source) return reply.code(404).send({ error: 'not found' });

    const bytes = await sourcesFor(token).get(sourcePath(wsId, briefId));
    if (!bytes) return reply.code(404).send({ error: 'not found' });

    // The bytes may have been put there straight through Storage, bypassing our checks: serve them as an inert
    // download with the type recorded in the database, never rendered in the browser.
    return reply
      .header('Content-Type', brief.source.mime)
      .header('Content-Disposition', contentDisposition(brief.source.name))
      .header('Content-Length', String(bytes.length))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .header('Content-Security-Policy', 'sandbox')
      .send(Buffer.from(bytes));
  });
};
