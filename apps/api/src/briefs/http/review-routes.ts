import { ApiErrorBody, BriefParams, BriefReviewResponse, ReviewEdit, type Brief, type WorkspaceRole } from '@briefly/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { IdentityRepo } from '../../identity/infra/identity-repo';
import { requireAuth } from '../../platform/auth';
import { generateReview, type ReviewGenerator, type ReviewsRepo } from '../application/generate-review';
import { briefPermissions } from '../domain/permissions';
import { isEditableStatus, toBriefReview } from '../domain/review';
import type { BriefsRepo } from '../infra/briefs-repo';

export type ReviewRoutesOptions = {
  identityFor: (accessToken: string) => IdentityRepo;
  briefsFor: (accessToken: string) => BriefsRepo;
  reviewsFor: (accessToken: string) => ReviewsRepo;
  generate: ReviewGenerator | null;
};

const errors = { 403: ApiErrorBody, 404: ApiErrorBody, 409: ApiErrorBody, 503: ApiErrorBody };

export const reviewRoutes: FastifyPluginAsyncZod<ReviewRoutesOptions> = async (app, { identityFor, briefsFor, reviewsFor, generate }) => {
  const permissions = (role: WorkspaceRole, brief: Brief) => {
    const write = briefPermissions(role).edit && isEditableStatus(brief.status);
    return { generate: write && generate !== null, edit: write };
  };

  // Role and brief together: not a member and no such brief both end as 404.
  const load = async (token: string, wsId: string, briefId: string) => {
    const [ws, brief] = await Promise.all([identityFor(token).findWorkspace(wsId), briefsFor(token).get(wsId, briefId)]);
    return ws && brief ? { role: ws.role, brief } : null;
  };

  const path = '/workspaces/:wsId/briefs/:briefId/review';

  app.get(path, { schema: { params: BriefParams, response: { 200: BriefReviewResponse, ...errors } } }, async (req, reply) => {
    const token = requireAuth(req).token;
    const found = await load(token, req.params.wsId, req.params.briefId);
    if (!found) return reply.code(404).send({ error: 'not found' });
    const row = await reviewsFor(token).get(req.params.wsId, req.params.briefId);
    return { review: row ? toBriefReview(row, found.brief.version) : null, permissions: permissions(found.role, found.brief) };
  });

  // Synchronous: the request waits for the model (≤ 50 s). The web disables the button meanwhile, and the
  // database claim makes a second click a 409 rather than a second model call.
  app.post(path, { schema: { params: BriefParams, response: { 200: BriefReviewResponse, ...errors } } }, async (req, reply) => {
    const token = requireAuth(req).token;
    const ws = await identityFor(token).findWorkspace(req.params.wsId);
    if (!ws) return reply.code(404).send({ error: 'not found' });

    const result = await generateReview(
      { findBrief: (w, b) => briefsFor(token).get(w, b), reviews: reviewsFor(token), generate },
      { wsId: ws.id, briefId: req.params.briefId, role: ws.role },
    );
    switch (result.kind) {
      case 'ok':
        return { review: result.review, permissions: permissions(ws.role, result.brief) };
      case 'not_found':
        return reply.code(404).send({ error: 'not found' });
      case 'forbidden':
        return reply.code(403).send({ error: 'forbidden' });
      case 'locked':
      case 'busy':
        return reply.code(409).send({ error: result.kind });
      case 'ai_unavailable':
        return reply.code(503).send({ error: 'ai_unavailable' });
    }
  });

  app.put(path, { schema: { params: BriefParams, body: ReviewEdit, response: { 200: BriefReviewResponse, ...errors } } }, async (req, reply) => {
    const token = requireAuth(req).token;
    const found = await load(token, req.params.wsId, req.params.briefId);
    if (!found) return reply.code(404).send({ error: 'not found' });
    const can = permissions(found.role, found.brief);
    if (!briefPermissions(found.role).edit) return reply.code(403).send({ error: 'forbidden' });
    if (!can.edit) return reply.code(409).send({ error: 'locked' });

    // Only over a succeeded review of the version the user was looking at; otherwise they edited stale text.
    if (req.body.briefVersion !== found.brief.version) return reply.code(409).send({ error: 'outdated' });
    const reviews = reviewsFor(token);
    const current = await reviews.get(req.params.wsId, req.params.briefId);
    if (current?.state !== 'succeeded') return reply.code(409).send({ error: 'no_review' });
    const saved = await reviews.saveEdit(req.params.wsId, req.params.briefId, req.body.briefVersion, req.body.review);
    if (!saved) return reply.code(409).send({ error: 'outdated' });
    const row = await reviews.get(req.params.wsId, req.params.briefId);
    return { review: row ? toBriefReview(row, found.brief.version) : null, permissions: can };
  });
};
