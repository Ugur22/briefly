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
    <form onSubmit={submit} aria-label="Edit review">
      {invalid && (
        <p role="alert">
          Each question or risk can be at most {REVIEW_LIMITS.item} characters, with at most {REVIEW_LIMITS.items} of each.
        </p>
      )}
      <p>
        <label>
          Summary
          <br />
          <textarea value={review.summary} maxLength={REVIEW_LIMITS.summary} rows={3} cols={80} onChange={(e) => setReview({ ...review, summary: e.target.value })} />
        </label>
      </p>
      {REVIEW_AREAS.map((area) => (
        <fieldset key={area}>
          <legend>{AREA_LABELS[area]}</legend>
          <label>
            Status{' '}
            <select
              value={review.areas[area].status}
              onChange={(e) => setReview({ ...review, areas: { ...review.areas, [area]: { ...review.areas[area], status: AreaStatus.parse(e.target.value) } } })}
            >
              {AreaStatus.options.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            Note{' '}
            <input
              value={review.areas[area].note}
              maxLength={REVIEW_LIMITS.note}
              size={60}
              onChange={(e) => setReview({ ...review, areas: { ...review.areas, [area]: { ...review.areas[area], note: e.target.value } } })}
            />
          </label>
        </fieldset>
      ))}
      <p>
        <label>
          Questions for the client (one per line)
          <br />
          <textarea value={questions} rows={4} cols={80} onChange={(e) => setQuestions(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Risks (one per line)
          <br />
          <textarea value={risks} rows={3} cols={80} onChange={(e) => setRisks(e.target.value)} />
        </label>
      </p>
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save review'}
      </button>{' '}
      <button type="button" onClick={onCancel} disabled={pending}>
        Cancel
      </button>
    </form>
  );
}
