import type { BriefStatus } from '@briefly/contracts';

export const STATUS_TEXT: Record<BriefStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
};

// Shape says where the brief is in its life (open ring, heavy ring, filled), so status never rests on hue alone.
// Teal stays reserved for actions; only the finished states get a colour.
const DOT: Record<BriefStatus, string> = {
  draft: 'border border-muted',
  in_review: 'border-[2.5px] border-ink-2',
  approved: 'bg-present',
  changes_requested: 'bg-unclear',
};

export function Status({ status }: { status: BriefStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-2">
      <span className={`size-2.5 shrink-0 rounded-full ${DOT[status]}`} aria-hidden />
      {STATUS_TEXT[status]}
    </span>
  );
}
