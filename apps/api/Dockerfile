# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM oven/bun:1.3.4 AS build
WORKDIR /repo

# Manifests first so the install layer is cached until dependencies change.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY libs/contracts/package.json libs/contracts/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY libs/contracts libs/contracts
COPY apps/api apps/api
RUN cd apps/api && bun run build

# The web app is served by the API from the same origin. Vite bakes the Okta settings into the bundle; the API
# checks at start that it was built for the issuer it verifies (and its CSP admits). Without them (CI), the API
# boots but does not serve the web.
ARG OKTA_ISSUER=""
ARG OKTA_CLIENT_ID=""
COPY apps/web apps/web
RUN cd apps/web && VITE_OKTA_ISSUER=$OKTA_ISSUER VITE_OKTA_CLIENT_ID=$OKTA_CLIENT_ID bunx vite build

FROM node:22-alpine
WORKDIR /app
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ARG OKTA_ISSUER=""
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA \
    WEB_DIST=/app/web WEB_OKTA_ISSUER=$OKTA_ISSUER
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/main.js"]
