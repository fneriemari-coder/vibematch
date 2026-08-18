# MatchService — Mobile/Web App (Flutter)

Cyber-Premium "VIBE MATCH" client: swipe matchmaking (Cloud/Local/B2B),
Discovery Feed with AI intent search, real-time chat, wallet/receivables
advance, and a locale-aware Premium paywall.

## Live web preview

`main` auto-deploys on every push through `.github/workflows/deploy-web.yml`,
which publishes two things to GitHub Pages from a single artifact:

| URL | What |
|---|---|
| https://fneriemari-coder.github.io/vibematch/ | `demo/tracao-continua.html`, the pitch prototype — self-contained, no backend |
| https://fneriemari-coder.github.io/vibematch/app/ | this app, `flutter build web --release` |

The build points `API_BASE_URL` at the Railway deployment (override it with an
`API_BASE_URL` repository variable). Every screen renders regardless, but
anything that hits the API — login, feed data, payments, chat — needs two
things to be true on the server side:

- the API is actually up: `GET /health` returns `{"status":"ok","db":"up"}`;
  `GET /health/integrations` reports which optional integrations have
  credentials, as booleans;
- `CORS_ORIGIN` includes `https://fneriemari-coder.github.io`. It is read as
  `(CORS_ORIGIN ?? '').split(',')`, so leaving it unset allows *no* origin and
  the browser blocks every request even against a perfectly healthy API.

## Verified against the real Flutter toolchain (CI, not locally)

This project was originally authored in a sandbox **without the Flutter SDK
installed**. It's since been run for real in GitHub Actions
(`.github/workflows/ci.yml`) — `flutter pub get`, `flutter analyze`,
`dart format --set-exit-if-changed`, and `flutter build web` are all green.
Native builds (`flutter build apk` / `ipa`) haven't been exercised — CI only
targets web — so expect the usual platform-specific plumbing (signing,
`google-services.json`, provisioning profiles) on the first real mobile
build.

## Setup

```bash
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:3000
```

### Firebase (push notifications)

Push notifications (`lib/core/services/notification_service.dart`) require
platform config files that aren't included here:

- `android/app/google-services.json`
- `ios/Runner/GoogleService-Info.plist`

Generate both from the Firebase Console (same project as the backend's
`FIREBASE_SERVICE_ACCOUNT_JSON`) and drop them in place before building for
a device — `Firebase.initializeApp()` in `main.dart` throws without them.

### Geolocation note

The original spec named a `geolocalization` package for lat/lng — that
package doesn't exist on pub.dev. `pubspec.yaml` uses `geolocator`, the
standard equivalent, instead.

## Structure

```
lib/
  core/
    api/dio_client.dart          — single Dio instance, JWT interceptor
    theme/vibe_match_theme.dart  — VIBE MATCH design tokens + ThemeData
    services/notification_service.dart — FCM: foreground banner, tap-to-open, token refresh
    utils/moderation_alert.dart  — blocked-post warning modal
  data/
    models/                      — AppUser, SwipeCandidate, DiscoveryFeedItem, ...
    repositories/                — one per backend module (auth, swipe, feed, wallet, post)
  logic/
    auth/auth_cubit.dart
    swipe/swipe_cubit.dart       — handles the 402 paywall-required state
    feed/feed_cubit.dart         — infinite scroll + AI "thinking" state
    subscription/subscription_cubit.dart
  presentation/
    screens/                     — HomeToggle, DiscoveryFeed, SwipeDeck, MatchSuccess,
                                    Paywall, Wallet, ChatRoom, CreatePost
    widgets/                     — VibeGlassCard, ScoreBadge, SwipeCard, DiscoveryPostCard
```

## Backend contract this app assumes

- `POST /auth/login|register`, `GET /auth/me`
- `GET /swipes/stack`, `POST /swipes` (may 402 → `SwipePaywallRequired`)
- `GET /feed/discover`, `POST /feed/post` (may 422 → moderation-blocked modal)
- `POST /ai/translate`
- `POST /wallet/advance`, `GET /escrow`
- `POST /billing/checkout` → `{ checkoutUrl }` for the paywall CTA
- `PUT /users/fcm-token`
- Socket.io namespace `/chat` (JWT via `auth.token` in the handshake)

See `../matchservice-backend/README.md` for the server side of all of these.
