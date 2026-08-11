# Debian (slim), not Alpine: Prisma's engines link against OpenSSL, and on
# Alpine the engine-detection step fails ("failed to detect the libssl/openssl
# version to use, defaulting to openssl-1.1.x") and then downloads a musl
# engine that can't load at runtime — the container dies on `migrate deploy`
# with "Could not parse schema engine response". Debian + an explicit openssl
# package is Prisma's documented, well-trodden path.

# --- Stage 1: build --------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Also needed at runtime, not just at build: the query engine loads libssl on
# every boot, and `prisma migrate deploy` runs the schema engine below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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
