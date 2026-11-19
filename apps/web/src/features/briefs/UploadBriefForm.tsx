import { BRIEF_FILE_MAX_BYTES, BRIEF_TITLE_MAX } from '@briefly/contracts';
import { FileUp } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';

const MESSAGES: Record<string, string> = {
  missing_file: 'Choose a PDF or Word file first.',
  too_large: 'That file is over 10 MB.',
  unsupported_type: 'Only PDF and Word (.docx) files can be uploaded.',
  unreadable: 'That file could not be read. Is it damaged or password-protected?',
  no_text: 'No text found in that file. A scanned PDF is an image; paste the text instead.',
  too_long: 'That file has more than 50,000 characters of text. Split it into smaller briefs.',
  busy: 'Briefly is reading other files right now. Try again in a moment.',
  rate_limited: "You've reached the upload limit for now. Try again in a few minutes.",
  forbidden: 'Your role in this workspace cannot create briefs.',
};

export const uploadErrorMessage = (err: unknown) =>
  (err instanceof ApiError && err.code && MESSAGES[err.code]) || 'Upload failed. Try again.';

type Props = { pending: boolean; error: unknown; onSubmit: (file: File, title: string) => void };

export function UploadBriefForm({ pending, error, onSubmit }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  // The server decides; this only saves a pointless 10 MB round trip.
  const tooLarge = file !== null && file.size > BRIEF_FILE_MAX_BYTES;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file && !tooLarge) onSubmit(file, title);
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      {(tooLarge || error !== null) && (
        <p role="alert" className="alert">
          {tooLarge ? MESSAGES.too_large : uploadErrorMessage(error)}
        </p>
      )}
      <label className="label">
        File (PDF or Word, up to 10 MB)
        <span className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong bg-surface px-4 py-6 text-center font-normal text-ink-2 transition-colors duration-150 ease-out hover:border-accent">
          <FileUp size={18} strokeWidth={1.5} className="text-muted" aria-hidden />
          {file ? <span className="text-ink">{file.name}</span> : <span>Choose a file</span>}
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </span>
      </label>
      <label className="label">
        Title (optional, defaults to the file name)
        <input className="input font-normal" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={BRIEF_TITLE_MAX} />
      </label>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending || !file || tooLarge}>
          {pending ? 'Reading file…' : 'Upload brief'}
        </button>
      </div>
    </form>
  );
}
