FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
# reproducible when package-lock.json is committed; plain install otherwise
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ── Builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ── Runner ────────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S botuser -u 1001

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/locales ./locales
COPY --from=builder /app/package.json ./package.json

# Create logs dir
RUN mkdir -p logs && chown -R botuser:nodejs logs

USER botuser

EXPOSE 3000

CMD ["node", "dist/index.js"]
