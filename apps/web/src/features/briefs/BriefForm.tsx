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
    <form onSubmit={submit}>
      <p>
        <label>
          Title
          <br />
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={BRIEF_TITLE_MAX} />
        </label>
      </p>
      <p>
        <label>
          Brief
          <br />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} cols={80} maxLength={BRIEF_BODY_MAX} />
        </label>
      </p>
      <button type="submit" disabled={pending || title.trim() === ''}>
        {pending ? 'Saving…' : submitLabel}
      </button>{' '}
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      )}
    </form>
  );
}
