# Admin portal service (docs/25).
FROM node:22-alpine AS base
RUN corepack enable || npm i -g pnpm@9
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/admin-web ./apps/admin-web
COPY tsconfig.base.json turbo.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @medpass/admin-web... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
USER node
WORKDIR /repo/apps/admin-web
EXPOSE 3001
# Not "pnpm start": Corepack lazily fetches the pnpm binary itself over the
# network on first invocation, which is a flaky, unnecessary dependency for a
# runtime container to have at all — invoke Next directly instead.
CMD ["node_modules/.bin/next", "start", "-p", "3001"]
