## Vibe Payroll Time — frontend image.
##
## Two-stage: build the Vite bundle with the full toolchain, then serve
## the static dist/ from nginx-alpine.
##
## Same image, every prefix. The bundle bakes the runtime sentinel
## `/__VIBE_BASE_PATH__/` into every asset URL, router basename,
## manifest start_url/scope, and PWA icon path. The web container's
## /docker-entrypoint.d/40-base-path.sh hook reads VITE_BASE_PATH from
## the container env at startup and sed-substitutes the sentinel across
## html/js/css/json/map/webmanifest files BEFORE nginx starts.
##
## Single-app : VITE_BASE_PATH=/        → assets at /assets/...
## Multi-app  : VITE_BASE_PATH=/payroll/ → assets at /payroll/assets/...
##
## (Same pattern as Vibe MyBooks + Vibe TB; see vite.config.ts and
## frontend/docker-entrypoint.d/40-base-path.sh in this repo.)

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN --mount=type=cache,target=/root/.npm \
    npm ci \
      --workspace=@vibept/frontend \
      --workspace=@vibept/shared \
      --include-workspace-root

COPY shared ./shared
COPY frontend ./frontend

RUN npm run build --workspace=@vibept/frontend

FROM nginx:1.27-alpine AS runtime
## nginx runs as non-root by default in the official alpine image since 1.25.

RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Runtime base-path substitution — runs before nginx (the upstream
# /docker-entrypoint.sh executes everything in /docker-entrypoint.d/ in
# numerical order). VITE_BASE_PATH defaults to '/' if unset. Strip CR
# in case the build context was checked out on Windows with
# core.autocrlf=true.
COPY frontend/docker-entrypoint.d/40-base-path.sh /docker-entrypoint.d/40-base-path.sh
COPY frontend/docker-entrypoint.d/50-build-version.sh /docker-entrypoint.d/50-build-version.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-base-path.sh \
                    /docker-entrypoint.d/50-build-version.sh \
 && chmod +x /docker-entrypoint.d/40-base-path.sh \
             /docker-entrypoint.d/50-build-version.sh

# Build version is baked at image build time via build-args and
# re-exposed as runtime env so the 50-build-version.sh entrypoint can
# substitute it into the service worker. Same pattern as APP_VERSION
# on the backend image.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
