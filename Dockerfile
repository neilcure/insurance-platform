FROM node:20-alpine AS base

# --- Dependencies stage ---
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# --- Build stage ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Production stage ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install only postgres driver for migrations
RUN npm init -y > /dev/null 2>&1 && npm install postgres@3.4.7 --save > /dev/null 2>&1

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy migration files and startup script
COPY --chown=nextjs:nodejs db/migrations ./db/migrations
COPY --chown=nextjs:nodejs migrate.js ./migrate.js
COPY --chown=nextjs:nodejs start.sh ./start.sh
RUN chmod +x start.sh

# Create uploads directory
RUN mkdir -p .uploads && chown nextjs:nodejs .uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["./start.sh"]
