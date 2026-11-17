import { BriefReviewResponse, type BriefReview, type Review } from '@briefly/contracts';

const winter: Review = {
  summary:
    'A clear objective and audience, with concrete deliverables. The budget is open and there are no KPIs, so the team cannot size the media plan or say what success looks like. Timing is tight for a film shoot.',
  areas: {
    objective: { status: 'present', note: 'Switch EV drivers to the home charging subscription before the 1 February price change.' },
    audience: { status: 'present', note: 'EV owners with a driveway, 30 to 55, on a green contract elsewhere.' },
    budget: { status: 'missing', note: 'Still being discussed internally; no range given.' },
    timing: { status: 'unclear', note: 'Launch in the second week of January, but no dates for approval rounds or the shoot.' },
    channels: { status: 'present', note: 'Instagram, YouTube pre-roll and OOH near charging hubs in Utrecht and Amsterdam.' },
    kpis: { status: 'missing', note: 'No target for sign-ups, cost per acquisition or reach.' },
    deliverables: { status: 'present', note: 'Hero film of 20 seconds, three social cut-downs, OOH in two formats, landing page.' },
  },
  questions: [
    'What budget range should we plan media and production against?',
    'How many new subscriptions would make this campaign a success?',
    'Who signs off on the film script, and by when?',
  ],
  risks: ['A January launch leaves about six weeks for script, shoot and edit over the holidays.', 'OOH near charging hubs may need municipal permits in Amsterdam.'],
};

const base: BriefReview = {
  state: 'succeeded',
  review: winter,
  briefVersion: 3,
  outdated: false,
  error: null,
  model: 'claude-opus-5-5',
  generatedAt: '2026-11-16T16:42:00+01:00',
  editedAt: null,
};

const canAct = { generate: true, edit: true };
const locked = { generate: false, edit: false };

export const reviews = {
  none: BriefReviewResponse.parse({ review: null, permissions: canAct }),
  generating: BriefReviewResponse.parse({ review: { ...base, state: 'pending', review: null, generatedAt: null, model: null }, permissions: canAct }),
  done: BriefReviewResponse.parse({ review: { ...base, editedAt: '2026-11-16T17:05:00+01:00' }, permissions: canAct }),
  outdated: BriefReviewResponse.parse({ review: { ...base, outdated: true }, permissions: canAct }),
  locked: BriefReviewResponse.parse({ review: base, permissions: locked }),
};
