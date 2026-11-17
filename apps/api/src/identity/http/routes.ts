import { ApiErrorBody, Me, Workspace, WorkspaceList, WorkspaceParams } from '@briefly/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuth } from '../../platform/auth';
import type { IdentityRepo } from '../infra/identity-repo';

export type IdentityRoutesOptions = { repoFor: (accessToken: string) => IdentityRepo };

export const identityRoutes: FastifyPluginAsyncZod<IdentityRoutesOptions> = async (app, { repoFor }) => {
  app.get('/me', { schema: { response: { 200: Me } } }, async (req) => {
    return repoFor(requireAuth(req).token).provisionMe();
  });

  app.get('/workspaces', { schema: { response: { 200: WorkspaceList } } }, async (req) => {
    return { workspaces: await repoFor(requireAuth(req).token).listWorkspaces() };
  });

  // Not a member and doesn't exist look identical, so ids can't be probed.
  app.get(
    '/workspaces/:wsId',
    { schema: { params: WorkspaceParams, response: { 200: Workspace, 404: ApiErrorBody } } },
    async (req, reply) => {
      const ws = await repoFor(requireAuth(req).token).findWorkspace(req.params.wsId);
      if (!ws) return reply.code(404).send({ error: 'not found' });
      return ws;
    },
  );
};
