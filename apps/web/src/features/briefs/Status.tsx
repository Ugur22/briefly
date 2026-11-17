import type { BriefStatus } from '@briefly/contracts';

export const STATUS_TEXT: Record<BriefStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
};

// The dot carries the meaning: grey draft, teal in review, sage approved, amber sent back.
const DOT: Record<BriefStatus, string> = {
  draft: 'bg-muted',
  in_review: 'bg-accent',
  approved: 'bg-present',
  changes_requested: 'bg-unclear',
};

export function Status({ status }: { status: BriefStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-2">
      <span className={`size-2 rounded-full ${DOT[status]}`} aria-hidden />
      {STATUS_TEXT[status]}
    </span>
  );
}
