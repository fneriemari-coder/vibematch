# --- Stage 1: build --------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Prisma Client must be generated against the schema before `nest build`,
# since the Nest build type-checks against the generated client types.
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: production runtime -------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3000
# Applies pending migrations before every boot — the container has real
# network access to the database (unlike the dev sandbox this was built in),
# so this is what actually keeps schema in sync on Railway/Render/etc.
# Single-instance deploys only: with N replicas booting in parallel this
# races (each runs `migrate deploy` concurrently) — fine for this project's
# scale, revisit with a dedicated release-phase step if that ever changes.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
