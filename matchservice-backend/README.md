# MatchService — Backend (NestJS)

Dual opt-in services marketplace API: Cloud/Local/B2B swipe matchmaking, Escrow,
Fintech (receivables advance + Stripe billing), SaaS Pro chat/Kanban, an
autonomous Discovery Feed (AI content publisher + AI moderator), trend-based
push notifications, and multi-currency subscriptions.

## Stack

NestJS 10 · Prisma 5 (PostgreSQL + PostGIS) · Socket.io · Stripe · OpenAI ·
Firebase Admin SDK · `@nestjs/schedule` cron jobs.

## Setup

```bash
npm install
cp .env.example .env   # fill in real secrets — see comments in the file
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed    # optional — 7 days of Discovery Feed launch content
npm run start:dev
```

Requires a PostgreSQL instance with the `postgis` extension available. The
bundled `docker-compose.yml` provisions Postgres+PostGIS, Redis, and the API
container together:

```bash
docker-compose up -d --build
```

## Verifying the build

```bash
npx tsc --noEmit -p tsconfig.json   # type-check only
npm run build                       # full Nest build (dist/)
```

Both were run against the current source tree with zero errors as of the
last change in this repo.

## Module map

| Module | Responsibility |
|---|---|
| `auth` | Register/login, JWT issuance, `JwtStrategy` |
| `users` | Profile CRUD, nearby search, `ScoreEngine` (Provider Score / K-Score) |
| `swipes` | Cloud/Local/B2B stacks, double opt-in match creation |
| `escrow` | `EscrowProject` lifecycle: create → fund → complete/dispute/refund/cancel |
| `fintech` | `/wallet/advance` receivables advance, Stripe Checkout (`billing.*`), Stripe webhooks |
| `chat` | Socket.io gateway, AI/DeepL translation, Kanban board (SaaS Pro gated) |
| `ai` | `/ai/translate` intent translator, `ai-publisher` (autonomous feed content, cron every 12h), `ai-moderator` (safety + on-topic gate for user posts) |
| `feed` | `/feed/discover` (Cloud+Local interleave for Premium/Pro), `/feed/post` (moderation-gated) |
| `notifications` | `trend-monitor` cron (every 30 min) + `push-notification` (FCM batch send) |

## Guards & gating

- `JwtAuthGuard` — required on every authenticated route.
- `SubscriptionGuard` + `@RequireTier(...)` — gates SaaS Pro features (Kanban,
  translated chat, receivables advance).
- `SubscriptionGuard` + `@EnforceSwipeLimit()` — caps FREE-tier users at 10
  swipes/day, returns HTTP 402 with a `redirect: 'PAYWALL'` payload once hit.
- `POST /feed/post` — every submission is moderated by `AiModeratorService`
  (OpenAI Moderation API + an on-topic classifier) before it can reach the
  public feed; a blocked post returns HTTP 422 and is persisted with
  `status = BLOCKED` for audit, never served by `/feed/discover`.

## Testing the moderation pipeline under load

```bash
npm run start:dev            # terminal 1
npm run test:moderation      # terminal 2 — 50 legit + 50 spam posts, concurrent
```

Prints a console report: legit-post success rate (expect ~100% HTTP 201),
spam-post block rate (expect ~100% HTTP 422), and average response time
(watch this — it includes the OpenAI moderation + classification round trip).

## Deploying

`Dockerfile` (multi-stage, Prisma-aware) + `docker-compose.yml` (API +
Postgres/PostGIS + Redis) + `deploy.sh` (git pull → install → migrate →
`docker-compose up -d --build` → prune) cover a single-host Ubuntu deploy on
DigitalOcean/AWS. Redis is provisioned but not yet consumed by application
code — chat and the trend monitor currently run in-process via
`@nestjs/schedule`; it's there so a BullMQ worker or a Socket.io Redis
adapter can be added later without new infra.

## Known gaps / things not yet wired

- No automated test suite (`npm test` runs Jest but no spec files exist yet)
  beyond the manual moderation stress test above.
- `/billing/checkout` assumes the four `STRIPE_PRICE_*` env vars are real
  Stripe Price IDs — nothing works against Stripe until those (and
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`) are filled in.
- Firebase push requires a real `FIREBASE_SERVICE_ACCOUNT_JSON`; without it
  `PushNotificationService` logs a warning and no-ops.
