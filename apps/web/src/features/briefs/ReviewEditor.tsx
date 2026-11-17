import { AreaStatus, REVIEW_AREAS, REVIEW_LIMITS, Review } from '@briefly/contracts';
import { useState, type FormEvent } from 'react';
import { AREA_LABELS, STATUS_LABELS } from './ReviewPanel';

// Lists are edited one item per line; empty lines are dropped.
const toLines = (items: string[]) => items.join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

type Props = { initial: Review; pending: boolean; onSave: (review: Review) => void; onCancel: () => void };

export function ReviewEditor({ initial, pending, onSave, onCancel }: Props) {
  const [review, setReview] = useState(initial);
  const [questions, setQuestions] = useState(toLines(initial.questions));
  const [risks, setRisks] = useState(toLines(initial.risks));
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // The same limits the API enforces, checked here so the message can say what's wrong.
    const next = Review.safeParse({ ...review, questions: fromLines(questions), risks: fromLines(risks) });
    setInvalid(!next.success);
    if (next.success) onSave(next.data);
  };

  return (
    <form onSubmit={submit} aria-label="Edit review" className="grid gap-5">
      {invalid && (
        <p role="alert" className="alert">
          Each question or risk can be at most {REVIEW_LIMITS.item} characters, with at most {REVIEW_LIMITS.items} of each.
        </p>
      )}
      <label className="label">
        Summary
        <textarea className="textarea font-normal" value={review.summary} maxLength={REVIEW_LIMITS.summary} rows={3} onChange={(e) => setReview({ ...review, summary: e.target.value })} />
      </label>
      <div className="grid divide-y divide-line border-y border-line">
        {REVIEW_AREAS.map((area) => (
          <fieldset key={area} className="grid items-center gap-2 py-3 sm:grid-cols-[120px_140px_minmax(0,1fr)] sm:gap-3">
            <legend className="sr-only">{AREA_LABELS[area]}</legend>
            <span aria-hidden className="font-medium">
              {AREA_LABELS[area]}
            </span>
            <label className="grid gap-1 text-xs text-muted">
              Status
              <select
                className="input text-sm"
                value={review.areas[area].status}
                onChange={(e) => setReview({ ...review, areas: { ...review.areas, [area]: { ...review.areas[area], status: AreaStatus.parse(e.target.value) } } })}
              >
                {AreaStatus.options.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Note
              <input
                className="input text-sm"
                value={review.areas[area].note}
                maxLength={REVIEW_LIMITS.note}
                onChange={(e) => setReview({ ...review, areas: { ...review.areas, [area]: { ...review.areas[area], note: e.target.value } } })}
              />
            </label>
          </fieldset>
        ))}
      </div>
      <label className="label">
        Questions for the client (one per line)
        <textarea className="textarea font-normal" value={questions} rows={4} onChange={(e) => setQuestions(e.target.value)} />
      </label>
      <label className="label">
        Risks (one per line)
        <textarea className="textarea font-normal" value={risks} rows={3} onChange={(e) => setRisks(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save review'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
