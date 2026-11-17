import { BRIEF_BODY_MAX, BRIEF_TITLE_MAX } from '@briefly/contracts';
import { useState, type FormEvent } from 'react';

type Props = {
  initial: { title: string; body: string };
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: { title: string; body: string }) => void;
  onCancel?: () => void;
};

// Uncontrolled by the server state on purpose: a failed save (conflict, network) keeps what the user typed.
export function BriefForm({ initial, submitLabel, pending, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ title, body });
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      <label className="label">
        Title
        <input className="input font-normal" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={BRIEF_TITLE_MAX} />
      </label>
      <label className="label">
        Brief
        <textarea
          className="textarea field-sizing-content min-h-40 max-h-[65vh] font-doc text-[17px] leading-7 font-normal text-ink"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={BRIEF_BODY_MAX}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending || title.trim() === ''}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
