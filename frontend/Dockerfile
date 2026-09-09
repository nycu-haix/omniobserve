FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
ARG VITE_API_BASE_URL
ARG VITE_WS_BASE_URL
ARG VITE_AUDIO_WS_BASE_URL
ARG VITE_JITSI_BASE_URL
RUN pnpm build


FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80