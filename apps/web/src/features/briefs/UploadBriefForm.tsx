import { BRIEF_FILE_MAX_BYTES, BRIEF_TITLE_MAX } from '@briefly/contracts';
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
    <form onSubmit={submit}>
      {(tooLarge || error !== null) && <p role="alert">{tooLarge ? MESSAGES.too_large : uploadErrorMessage(error)}</p>}
      <p>
        <label>
          File (PDF or Word, up to 10 MB)
          <br />
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </p>
      <p>
        <label>
          Title (optional, defaults to the file name)
          <br />
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={BRIEF_TITLE_MAX} />
        </label>
      </p>
      <button type="submit" disabled={pending || !file || tooLarge}>
        {pending ? 'Reading file…' : 'Upload brief'}
      </button>
    </form>
  );
}
