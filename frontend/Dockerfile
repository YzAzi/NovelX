FROM node:20-alpine AS deps

WORKDIR /app

RUN corepack enable \
  && pnpm config set registry https://registry.npmmirror.com

COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable \
  && pnpm config set registry https://registry.npmmirror.com

COPY --from=deps /app/node_modules /app/node_modules

COPY frontend ./

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

RUN addgroup -S nodejs \
  && adduser -S nextjs -G nodejs

COPY --from=builder /app/public /app/public
COPY --from=builder /app/.next/standalone /app/
COPY --from=builder /app/.next/static /app/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
