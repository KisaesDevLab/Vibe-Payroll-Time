## Vibe Payroll Time — frontend image.
##
## Two-stage: build the Vite bundle with the full toolchain, then serve the
## static dist/ from nginx-alpine. Caddy sits in front of both backend and
## frontend and handles TLS.

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
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_APP_NAME="Vibe Payroll Time"
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_APP_NAME=${VITE_APP_NAME}

RUN npm run build --workspace=@vibept/frontend

FROM nginx:1.27-alpine AS runtime
## nginx runs as non-root by default in the official alpine image since 1.25.

RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
