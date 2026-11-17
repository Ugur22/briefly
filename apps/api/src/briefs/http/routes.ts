import { ApiErrorBody, BriefCreate, BriefList, BriefParams, BriefResponse, BriefUpdate, WorkspaceParams } from '@briefly/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { IdentityRepo } from '../../identity/infra/identity-repo';
import { requireAuth } from '../../platform/auth';
import { briefPermissions } from '../domain/permissions';
import type { BriefsRepo } from '../infra/briefs-repo';

export type BriefsRoutesOptions = {
  identityFor: (accessToken: string) => IdentityRepo;
  briefsFor: (accessToken: string) => BriefsRepo;
};

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not found' });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });

const errors = { 403: ApiErrorBody, 404: ApiErrorBody, 409: ApiErrorBody };

// The caller's role comes from their membership (RLS-filtered): not a member and no such workspace both 404.
// Reads fetch the role and the data in parallel; writes need the role first to refuse with a clear 403.
export const briefsRoutes: FastifyPluginAsyncZod<BriefsRoutesOptions> = async (app, { identityFor, briefsFor }) => {
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
      return reply.code(201).send({ brief, permissions: { edit: can.edit, delete: can.delete } });
    },
  );

  app.get('/workspaces/:wsId/briefs/:briefId', { schema: { params: BriefParams, response: { 200: BriefResponse, ...errors } } }, async (req, reply) => {
    const { identity, briefs } = repos(requireAuth(req).token);
    const [ws, brief] = await Promise.all([identity.findWorkspace(req.params.wsId), briefs.get(req.params.wsId, req.params.briefId)]);
    if (!ws || !brief) return notFound(reply);
    const can = briefPermissions(ws.role);
    return { brief, permissions: { edit: can.edit, delete: can.delete } };
  });

  app.put(
    '/workspaces/:wsId/briefs/:briefId',
    { schema: { params: BriefParams, body: BriefUpdate, response: { 200: BriefResponse, ...errors } } },
    async (req, reply) => {
      const { identity, briefs } = repos(requireAuth(req).token);
      const ws = await identity.findWorkspace(req.params.wsId);
      if (!ws) return notFound(reply);
      const can = briefPermissions(ws.role);
      if (!can.edit) return forbidden(reply);

      const result = await briefs.update(ws.id, req.params.briefId, req.body);
      switch (result.kind) {
        case 'ok':
          return { brief: result.brief, permissions: { edit: can.edit, delete: can.delete } };
        case 'not_found':
          return notFound(reply);
        case 'conflict':
          return reply.code(409).send({ error: 'conflict' });
        case 'forbidden':
          return forbidden(reply);
      }
    },
  );

  app.delete('/workspaces/:wsId/briefs/:briefId', { schema: { params: BriefParams, response: { 204: z.null(), 403: ApiErrorBody, 404: ApiErrorBody } } }, async (req, reply) => {
    const { identity, briefs } = repos(requireAuth(req).token);
    const ws = await identity.findWorkspace(req.params.wsId);
    if (!ws) return notFound(reply);
    if (!briefPermissions(ws.role).delete) return forbidden(reply);
    const removed = await briefs.remove(ws.id, req.params.briefId);
    return removed ? reply.code(204).send(null) : notFound(reply);
  });
};
