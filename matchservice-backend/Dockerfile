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

# Compiled separately from the app: prisma/seed.ts sits outside src/ (and so
# outside the app tsconfig), and ts-node is a devDependency that never reaches
# the runtime image. This produces a plain JS artifact so the seed can be run
# on demand from the platform's shell — `npm run seed:prod`.
RUN npm run build:seed

# Same reasoning, two more on-demand console scripts: the simulated-population
# generator (`npm run seed:sim`) and the AI course catalogue
# (`npm run seed:ai-courses`). Neither runs at build or boot time — they are
# compiled here only so the production image actually contains them when the
# owner opens a shell on the platform. Skipping this step is invisible locally
# (ts-node covers it) and only fails in production, where there is no ts-node
# and no src/ to compile from.
RUN npm run build:seed-sim
RUN npm run build:seed-ai-courses

# --- Stage 2: production runtime -------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# openssl/ca-certificates are needed at runtime, not just at build: the query
# engine loads libssl on every boot, and `prisma migrate deploy` runs the
# schema engine below.
#
# ffmpeg and the font are what lesson-video.service.ts shells out to when it
# turns a module's narration script into a watchable MP4. They are runtime-only
# — nothing in the build touches them — and the service degrades to "not
# attempted, ffmpeg is not installed" rather than failing if this line is ever
# dropped. fonts-dejavu-core is a couple of megabytes and is the difference
# between a lesson with its title on screen and one without.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    openssl ca-certificates ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-seed ./dist-seed

EXPOSE 3000
# Applies pending migrations before every boot — the container has real
# network access to the database (unlike the dev sandbox this was built in),
# so this is what actually keeps schema in sync on Railway/Render/etc.
# Single-instance deploys only: with N replicas booting in parallel this
# races (each runs `migrate deploy` concurrently) — fine for this project's
# scale, revisit with a dedicated release-phase step if that ever changes.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
