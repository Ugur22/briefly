import { Review } from '@briefly/contracts';
import { z } from 'zod';

const fields = Review.extend({ questions: z.string(), risks: z.string() });
const storedDraft = z.object({
  generatedAt: z.string().nullable(),
  editedAt: z.string().nullable(),
  version: z.number().int(),
  fields,
});

export type ReviewFields = z.infer<typeof fields>;
export type ReviewDraft = z.infer<typeof storedDraft>;

export function readDraft(key: string | undefined): ReviewDraft | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? storedDraft.safeParse(JSON.parse(raw)).data ?? null : null;
  } catch {
    return null;
  }
}

export function storeDraft(key: string | undefined, draft: ReviewDraft | null) {
  if (!key) return;
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    // Editing still works in memory when tab storage is unavailable.
  }
}
