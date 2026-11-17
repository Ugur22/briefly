import { ApiErrorBody, BriefCreate, Decision, Submit, BriefList, BriefParams, BriefResponse, BriefUpdate, WorkspaceParams } from '@briefly/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { IdentityRepo } from '../../identity/infra/identity-repo';
import { requireAuth } from '../../platform/auth';
import { briefPermissions } from '../domain/permissions';
import { briefActions } from '../domain/workflow';
import { sourcePath } from '../domain/source-file';
import type { BriefsRepo } from '../infra/briefs-repo';
import type { SourceStorage } from '../infra/source-storage';

export type BriefsRoutesOptions = {
  identityFor: (accessToken: string) => IdentityRepo;
  briefsFor: (accessToken: string) => BriefsRepo;
  sourcesFor: (accessToken: string) => SourceStorage;
};

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not found' });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });

const errors = { 403: ApiErrorBody, 404: ApiErrorBody, 409: ApiErrorBody };

// The caller's role comes from their membership (RLS-filtered): not a member and no such workspace both 404.
// Reads fetch the role and the data in parallel; writes need the role first to refuse with a clear 403.
export const briefsRoutes: FastifyPluginAsyncZod<BriefsRoutesOptions> = async (app, { identityFor, briefsFor, sourcesFor }) => {
  const repos = (token: string) => ({ identity: identityFor(token), briefs: briefsFor(token) });

  app.get('/workspaces/:wsId/briefs', { schema: { params: WorkspaceParams, response: { 200: BriefList, ...errors } } }, async (req, reply) => {
    const { identity, briefs } = repos(requireAuth(req).token);
    const [ws, list] = await Promise.all([identity.findWorkspace(req.params.wsId), briefs.list(req.params.wsId)]);
    if (!ws) return notFound(reply);
    return { briefs: list, permissions: { create: briefPermissions(ws.role).create } };
  });

  app.post(
    '/workspaces/:wsId/briefs',
    { schema: { params: WorkspaceParams, body: BriefCreate, response: { 201: BriefResponse, ...errors } } },
    async (req, reply) => {
      const { identity, briefs } = repos(requireAuth(req).token);
      const ws = await identity.findWorkspace(req.params.wsId);
      if (!ws) return notFound(reply);
      const can = briefPermissions(ws.role);
      if (!can.create) return forbidden(reply);
      const brief = await briefs.create(ws.id, req.body);
      return reply.code(201).send({ brief, permissions: briefActions(ws.role, brief.status) });
    },
  );

  app.get('/workspaces/:wsId/briefs/:briefId', { schema: { params: BriefParams, response: { 200: BriefResponse, ...errors } } }, async (req, reply) => {
    const { identity, briefs } = repos(requireAuth(req).token);
    const [ws, brief] = await Promise.all([identity.findWorkspace(req.params.wsId), briefs.get(req.params.wsId, req.params.briefId)]);
    if (!ws || !brief) return notFound(reply);
    return { brief, permissions: briefActions(ws.role, brief.status) };
  });

  app.put(
    '/workspaces/:wsId/briefs/:briefId',
    { schema: { params: BriefParams, body: BriefUpdate, response: { 200: BriefResponse, ...errors } } },
    async (req, reply) => {
      const { identity, briefs } = repos(requireAuth(req).token);
      const ws = await identity.findWorkspace(req.params.wsId);
      if (!ws) return notFound(reply);
      if (!briefPermissions(ws.role).edit) return forbidden(reply);

      // A locked brief (in review, approved) is refused by the workflow trigger: 409 locked.
      const result = await briefs.update(ws.id, req.params.briefId, req.body);
      switch (result.kind) {
        case 'ok':
          return { brief: result.brief, permissions: briefActions(ws.role, result.brief.status) };
        case 'not_found':
          return notFound(reply);
        case 'conflict':
          return reply.code(409).send({ error: 'conflict' });
        case 'forbidden':
          return forbidden(reply);
      }
    },
  );

  // Submit and decide only send the new status; the workflow trigger checks role, transition, the current review
  // and self-approval, and its refusals come back as specific errors (409 locked/no_current_review/…, 403 self_approval).
  const workflowErrors = { ...errors, 422: ApiErrorBody };

  app.post(
    '/workspaces/:wsId/briefs/:briefId/submit',
    { schema: { params: BriefParams, body: Submit, response: { 200: BriefResponse, ...workflowErrors } } },
    async (req, reply) => {
      const { identity, briefs } = repos(requireAuth(req).token);
      const ws = await identity.findWorkspace(req.params.wsId);
      if (!ws) return notFound(reply);
      if (!briefPermissions(ws.role).edit) return forbidden(reply);
      const result = await briefs.submit(ws.id, req.params.briefId, req.body.version);
      if (result.kind === 'not_found') return notFound(reply);
      if (result.kind === 'conflict') return reply.code(409).send({ error: 'conflict' });
      return { brief: result.brief, permissions: briefActions(ws.role, result.brief.status) };
    },
  );

  app.post(
    '/workspaces/:wsId/briefs/:briefId/decision',
    { schema: { params: BriefParams, body: Decision, response: { 200: BriefResponse, ...workflowErrors } } },
    async (req, reply) => {
      const { identity, briefs } = repos(requireAuth(req).token);
      const ws = await identity.findWorkspace(req.params.wsId);
      if (!ws) return notFound(reply);
      if (ws.role !== 'approver' && ws.role !== 'admin') return forbidden(reply);
      const result = await briefs.decide(ws.id, req.params.briefId, req.body);
      if (result.kind === 'not_found') return notFound(reply);
      if (result.kind === 'conflict') return reply.code(409).send({ error: 'not_in_review' });
      return { brief: result.brief, permissions: briefActions(ws.role, result.brief.status) };
    },
  );

  app.delete('/workspaces/:wsId/briefs/:briefId', { schema: { params: BriefParams, response: { 204: z.null(), 403: ApiErrorBody, 404: ApiErrorBody } } }, async (req, reply) => {
    const { identity, briefs } = repos(requireAuth(req).token);
    const ws = await identity.findWorkspace(req.params.wsId);
    if (!ws) return notFound(reply);
    if (!briefPermissions(ws.role).delete) return forbidden(reply);
    const removed = await briefs.remove(ws.id, req.params.briefId);
    if (!removed) return notFound(reply);
    // The row is gone, so its original is unreachable; remove it too (best effort: an orphan holds no access).
    await sourcesFor(requireAuth(req).token)
      .remove(sourcePath(ws.id, req.params.briefId))
      .catch((err: unknown) => req.log.warn({ err }, 'original not removed after brief delete'));
    return reply.code(204).send(null);
  });
};
