## Vibe Payroll Time — frontend image.
##
## Two-stage: build the Vite bundle with the full toolchain, then serve the
## static dist/ from nginx-alpine. Caddy sits in front of api + web and
## handles TLS.

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

## Build-time VITE_ variables are compiled into the bundle.
##
## VITE_BASE_PATH controls Vite's `base`, which prefixes asset URLs and the
## PWA manifest scope. Single-app default `/`; the multi-app deployment
## overlay sets `/payroll/` so the SPA serves correctly under the shared
## Caddy ingress prefix. VITE_API_BASE_URL must align with VITE_BASE_PATH
## (e.g. `/payroll/api/v1`) when deployed multi-app.
ARG VITE_BASE_PATH=/
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_APP_NAME="Vibe Payroll Time"
ENV VITE_BASE_PATH=${VITE_BASE_PATH} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_APP_NAME=${VITE_APP_NAME}

RUN npm run build --workspace=@vibept/frontend

# When VITE_BASE_PATH is non-root (e.g. `/payroll/`), Vite bakes that
# prefix into every asset URL inside the bundle (`<script src="/payroll/
# assets/x.js">`). For nginx to serve those URLs without a rewrite, the
# files must live at the matching path on disk. We move dist/* into a
# subdirectory matching the base path so URL → file lookup is 1:1.
#
# Single-app (`/`) skips the move; dist stays at the conventional root.
# `${VITE_BASE_PATH%/}` strips any trailing slash; if the result is the
# empty string the bundle stays at the conventional root (single-app).
# Otherwise we relocate dist/* into a subdirectory matching the prefix.
RUN prefix="${VITE_BASE_PATH%/}"; \
    if [ -n "$prefix" ]; then \
      mkdir -p "frontend/dist-prefixed${prefix}"; \
      mv frontend/dist/* "frontend/dist-prefixed${prefix}/"; \
      rmdir frontend/dist; \
      mv frontend/dist-prefixed frontend/dist; \
    fi

FROM nginx:1.27-alpine AS runtime
## nginx runs as non-root by default in the official alpine image since 1.25.

# Same VITE_BASE_PATH is needed in the runtime stage so the SPA fallback
# location in nginx.conf can point at the right index.html. Cheaper than
# templating at container start.
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Substitute the SPA fallback placeholder with the resolved index path.
# Normalize VITE_BASE_PATH so `/payroll`, `/payroll/`, and `/` all produce
# a correct path (single-app gets `/index.html`, multi-app gets
# `/payroll/index.html`).
RUN base="${VITE_BASE_PATH%/}/"; \
    sed -i "s|__SPA_INDEX__|${base}index.html|g" \
      /etc/nginx/conf.d/default.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
