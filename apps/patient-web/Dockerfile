# Patient PWA service (docs/25).
FROM node:22-alpine AS base
RUN corepack enable || npm i -g pnpm@9
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/patient-web ./apps/patient-web
COPY tsconfig.base.json turbo.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @medpass/patient-web... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
USER node
WORKDIR /repo/apps/patient-web
EXPOSE 3000
# Not "pnpm start": Corepack lazily fetches the pnpm binary itself over the
# network on first invocation, which is a flaky, unnecessary dependency for a
# runtime container to have at all — invoke Next directly instead.
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
