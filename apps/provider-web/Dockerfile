# Provider portal service (docs_v2/12 §2/§3: clinic.medicinepassport.app).
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
COPY apps/provider-web ./apps/provider-web
COPY tsconfig.base.json turbo.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @medpass/provider-web... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
USER node
WORKDIR /repo/apps/provider-web
EXPOSE 3003
# Not "pnpm start": Corepack lazily fetches pnpm over the network on first
# invocation, a flaky and unnecessary dependency for a runtime container.
CMD ["node_modules/.bin/next", "start", "-p", "3003"]
