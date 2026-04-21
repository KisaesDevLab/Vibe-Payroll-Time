## Vibe Payroll Time — backend image.
##
## tsx runs the TypeScript source directly; no tsc emit step is needed. The
## workspace layout is preserved at /app so `@vibept/shared` resolves via npm
## workspaces. For a production appliance this is faster to iterate on than a
## bundle step and the cold-start penalty (~50 ms) is negligible.

FROM node:20-alpine AS deps
WORKDIR /app

# Copy only manifests first so the install layer is cache-friendly. Frontend
# workspace manifest is needed so npm's workspace resolver doesn't error, but
# its dependencies are never installed thanks to --omit-workspace-root + the
# specific --workspace flags below.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN --mount=type=cache,target=/root/.npm \
    npm ci \
      --workspace=@vibept/backend \
      --workspace=@vibept/shared \
      --include-workspace-root

FROM node:20-alpine AS runtime
WORKDIR /app

## Run as non-root. tini reaps zombies and forwards signals so SIGTERM reaches
## the Node process for graceful shutdown. UID pinned at 2000 so the host
## installer can chown the update-control bind-mount to a predictable uid.
RUN apk add --no-cache tini curl \
    && addgroup -S -g 2000 vibept \
    && adduser -S -u 2000 -G vibept -H -s /sbin/nologin vibept

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json* ./

COPY --chown=vibept:vibept shared ./shared
COPY --chown=vibept:vibept backend ./backend
COPY --chown=vibept:vibept tsconfig.base.json ./

# Optional build-time metadata. The CI pipeline passes these via
# `--build-arg`; /api/v1/version surfaces them at runtime.
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
ENV APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_DATE=${BUILD_DATE} \
    NODE_ENV=production \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=4000

USER vibept
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/v1/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx/esm", "--enable-source-maps", "backend/src/server.ts"]
