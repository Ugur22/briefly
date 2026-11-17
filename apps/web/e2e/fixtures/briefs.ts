import { BriefList, BriefResponse, type Brief, type BriefPermissions } from '@briefly/contracts';
import { colleague, me, noordzee } from './workspaces';

const WINTER_BODY = `Campaign: Laden zonder gedoe, winter 2027

Noordzee Energie wants more EV drivers in the Randstad to switch to its home charging subscription before the price change on 1 February.

Audience: owners of a fully electric car who live in an owner-occupied house with a driveway, roughly 30 to 55, already on a green energy contract with another supplier.

We want to run on Instagram, YouTube pre-roll and a few out-of-home placements near charging hubs in Utrecht and Amsterdam. The tone should be calm and practical, not salesy: show how little effort switching takes.

Deliverables: a 20-second hero film, three cut-downs for social, OOH posters in two formats and a landing page.

Budget is still being discussed internally. Launch in the second week of January.`;

const BATTERY_BODY = `Brief: Thuisbatterij, voorjaar 2027

Noordzee Energie starts selling home batteries to customers who already have solar panels. Objective: 2,500 orders before the end of June.

Audience: existing customers with at least 8 solar panels, mostly in Noord-Holland and Utrecht.

Channels: email to the customer base, Meta, and a radio flight in April. Budget € 120,000 excluding production. KPIs: orders, cost per order under € 40, email click rate.`;
const ids = {
  draft: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  generating: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
  reviewed: '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f',
  outdated: '4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f8a',
  inReview: '5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8a9b',
  mine: '6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f8a9b0c',
  changes: '7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d',
  approved: '8b9c0d1e-2f3a-4b4c-9d6e-7f8a9b0c1d2e',
  uploaded: '9c0d1e2f-3a4b-4c5d-8e7f-8a9b0c1d2e3f',
} as const;
export type BriefKey = keyof typeof ids;

const all: BriefPermissions = { edit: true, delete: true, submit: false, decide: false };
const locked: BriefPermissions = { edit: false, delete: false, submit: false, decide: false };

function brief(id: string, title: string, body: string, updatedAt: string, extra: Partial<Brief> = {}): Brief {
  return {
    id,
    workspaceId: noordzee.id,
    title,
    status: 'draft',
    version: 1,
    body,
    createdAt: '2026-11-10T14:05:00+01:00',
    updatedAt,
    source: null,
    submittedBy: null,
    submittedAt: null,
    decidedAt: null,
    decisionComment: null,
    ...extra,
  };
}

const entries: Record<BriefKey, [Brief, BriefPermissions]> = {
  draft: [brief(ids.draft, 'Thuisbatterij, voorjaar 2027', BATTERY_BODY, '2026-11-17T08:52:00+01:00'), all],
  generating: [brief(ids.generating, 'Laden zonder gedoe, eerste versie', WINTER_BODY, '2026-11-17T09:12:00+01:00'), all],
  reviewed: [brief(ids.reviewed, 'Laden zonder gedoe, winter 2027', WINTER_BODY, '2026-11-16T16:40:00+01:00', { version: 3 }), { ...all, submit: true }],
  outdated: [brief(ids.outdated, 'Dynamisch tarief uitgelegd', WINTER_BODY, '2026-11-16T11:20:00+01:00', { version: 4 }), { ...all, submit: false }],
  inReview: [
    brief(ids.inReview, 'Zonnepanelen op huurwoningen', BATTERY_BODY, '2026-11-15T10:03:00+01:00', {
      status: 'in_review',
      version: 2,
      submittedBy: colleague,
      submittedAt: '2026-11-15T10:03:00+01:00',
    }),
    { ...locked, decide: true },
  ],
  mine: [
    brief(ids.mine, 'Warmtepomp actieweken', BATTERY_BODY, '2026-11-14T15:30:00+01:00', {
      status: 'in_review',
      version: 2,
      submittedBy: me.id,
      submittedAt: '2026-11-14T15:30:00+01:00',
    }),
    { ...locked, decide: true },
  ],
  changes: [
    brief(ids.changes, 'Energiedeal voor studenten', BATTERY_BODY, '2026-11-13T09:45:00+01:00', {
      status: 'changes_requested',
      version: 2,
      submittedBy: me.id,
      submittedAt: '2026-11-12T17:10:00+01:00',
      decidedAt: '2026-11-13T09:45:00+01:00',
      decisionComment: 'The split between email, Meta and radio is missing, and the client has not confirmed the April radio flight. Ask them both before we resubmit.',
    }),
    { ...all, submit: true },
  ],
  approved: [
    brief(ids.approved, 'Kerstcampagne klantenservice', BATTERY_BODY, '2026-11-11T13:20:00+01:00', {
      status: 'approved',
      version: 3,
      submittedBy: colleague,
      submittedAt: '2026-11-10T16:00:00+01:00',
      decidedAt: '2026-11-11T13:20:00+01:00',
      decisionComment: 'Good to go, budget confirmed by the client on Monday',
    }),
    locked,
  ],
  uploaded: [
    brief(ids.uploaded, 'Q1 2027 brand brief', WINTER_BODY, '2026-11-17T09:05:00+01:00', {
      source: { name: 'Noordzee_Q1-2027_brief_v2.pdf', mime: 'application/pdf', size: 482_316 },
    }),
    all,
  ],
};

export const briefResponse = (key: BriefKey) => {
  const [b, permissions] = entries[key];
  return BriefResponse.parse({ brief: b, permissions });
};
export const briefId = (key: BriefKey) => ids[key];

export const briefList = BriefList.parse({
  briefs: Object.values(entries)
    .map(([b]) => b)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ id, workspaceId, title, status, version, updatedAt }) => ({ id, workspaceId, title, status, version, updatedAt })),
  permissions: { create: true },
});
