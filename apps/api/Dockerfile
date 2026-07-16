# API service (docs/25): multi-stage, non-root, stateless, graceful shutdown.
FROM node:22-alpine AS base
RUN corepack enable || npm i -g pnpm@9
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY tsconfig.base.json turbo.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @medpass/database generate
RUN pnpm --filter @medpass/api... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
# SIGTERM triggers Nest's shutdown hooks (enableShutdownHooks in main.ts).
CMD ["node", "dist/main.js"]
