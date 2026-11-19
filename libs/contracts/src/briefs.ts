import { z } from 'zod';

// Stricter than the database checks on purpose: a value Node accepts must never trip a DB check constraint,
// because Postgres logs the failing row (brief text included) when one does.
export const BRIEF_TITLE_MAX = 200;
export const BRIEF_BODY_MAX = 50_000;

export const BriefStatus = z.enum(['draft', 'in_review', 'approved', 'changes_requested']);
export type BriefStatus = z.infer<typeof BriefStatus>;

export const BriefSummary = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  title: z.string(),
  status: BriefStatus,
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type BriefSummary = z.infer<typeof BriefSummary>;

export const BRIEF_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const BriefSourceMime = z.enum([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
export type BriefSourceMime = z.infer<typeof BriefSourceMime>;

// The original file an uploaded brief was extracted from.
export const BriefSource = z.object({
  name: z.string(),
  mime: BriefSourceMime,
  size: z.number().int().positive(),
});
export type BriefSource = z.infer<typeof BriefSource>;

export const Brief = BriefSummary.extend({
  body: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  source: BriefSource.nullable(),
  // The workflow, as recorded by the database. submittedBy is a user id so the web can tell "you submitted this".
  submittedBy: z.uuid().nullable(),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  decisionComment: z.string().nullable(),
});
export type Brief = z.infer<typeof Brief>;

export const BriefPermissions = z.object({
  edit: z.boolean(),
  delete: z.boolean(),
  submit: z.boolean(),
  // Approve or send back. The database also refuses whoever submitted it; the web hides the buttons for them.
  decide: z.boolean(),
});
export type BriefPermissions = z.infer<typeof BriefPermissions>;

export const BriefList = z.object({
  briefs: z.array(BriefSummary),
  permissions: z.object({ create: z.boolean() }),
});
export type BriefList = z.infer<typeof BriefList>;

export const BriefResponse = z.object({
  brief: Brief,
  permissions: BriefPermissions,
});
export type BriefResponse = z.infer<typeof BriefResponse>;

// Postgres text can't hold NUL or a lone UTF-16 surrogate (JSON.parse accepts both). Left to the database they
// become a 500, and the error context Postgres logs quotes the brief text, so refuse them here as a 400.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const storable = (s: string) => !s.includes('\0') && !LONE_SURROGATE.test(s);
const title = z.string().trim().min(1).max(BRIEF_TITLE_MAX).refine(storable, 'contains characters that cannot be stored');
const body = z.string().max(BRIEF_BODY_MAX).refine(storable, 'contains characters that cannot be stored');

export const BriefCreate = z.object({ title, body });
export type BriefCreate = z.infer<typeof BriefCreate>;

export const BriefUpdate = z.object({ title, body, version: z.number().int().positive() });
export type BriefUpdate = z.infer<typeof BriefUpdate>;

export const BriefParams = z.object({
  wsId: z.uuid(),
  briefId: z.uuid(),
});

// Why an upload was refused, so the web can say something specific. Status codes: 413 too_large,
// 415 unsupported_type, 422 the rest, 429 rate_limited (this user's upload limit), 503 busy (extraction capacity
// full; try again).
export const UploadError = z.enum(['missing_file', 'too_large', 'unsupported_type', 'unreadable', 'no_text', 'too_long', 'busy', 'rate_limited']);
export type UploadError = z.infer<typeof UploadError>;
export const UploadErrorBody = z.object({ error: UploadError });

export const Submit = z.object({ version: z.number().int().positive() });
export type Submit = z.infer<typeof Submit>;

export const Decision = z
  .object({
    decision: z.enum(['approve', 'request_changes']),
    comment: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.decision === 'approve' || (d.comment ?? '') !== '', { message: 'say what needs to change', path: ['comment'] });
export type Decision = z.infer<typeof Decision>;
