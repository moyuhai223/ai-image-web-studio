FROM node:22-alpine AS deps
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=always \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=Asia/Shanghai
ENV APP_TIME_ZONE=Asia/Shanghai

RUN apk add --no-cache tzdata su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/storage/images /app/storage/references \
  && chown -R nextjs:nodejs /app

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/CHANGELOG.md ./CHANGELOG.md
COPY --from=builder --chown=nextjs:nodejs /app/lib/schema.sql ./lib/schema.sql
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# 入口脚本:以 root 确保 bind-mount 进来的 storage 目录可写(创建 images/references 并归属 nextjs),
# 再用 su-exec 降权到 nextjs 运行应用。这样无论宿主挂载目录归谁,每次启动都自愈,
# 避免上传参考图 / 保存生成图时报 "EACCES: permission denied, mkdir '/app/storage/...'"。
RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  'mkdir -p /app/storage/images /app/storage/references' \
  'chown nextjs:nodejs /app/storage /app/storage/images /app/storage/references 2>/dev/null || true' \
  'exec su-exec nextjs:nodejs "$@"' \
  > /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "scripts/start-production.mjs"]
