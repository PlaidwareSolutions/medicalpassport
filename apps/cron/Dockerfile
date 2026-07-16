# Cron jobs image (docs/25): Railway cron invokes one job entrypoint, which
# runs to completion and exits. Override CMD per cron schedule, e.g.
#   node dist/jobs/cleanup-expired-otps.js
FROM node:22-alpine AS base
RUN corepack enable || npm i -g pnpm@9
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/cron ./apps/cron
COPY tsconfig.base.json turbo.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @medpass/database generate
RUN pnpm --filter @medpass/cron... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
USER node
WORKDIR /repo/apps/cron
CMD ["node", "dist/jobs/verify-audit-chain.js"]
