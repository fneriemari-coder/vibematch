# MatchService — Mobile/Web App (Flutter)

Cyber-Premium "VIBE MATCH" client: swipe matchmaking (Cloud/Local/B2B),
Discovery Feed with AI intent search, real-time chat, wallet/receivables
advance, and a locale-aware Premium paywall.

## ⚠️ Not yet verified against the Flutter toolchain

This project was authored in an environment **without the Flutter SDK
installed**, so none of the following have been run against this code:
`flutter pub get`, `flutter analyze`, `flutter build`, or any widget/golden
test. All relative imports were verified to resolve to real files, and every
`package:` import used in the source is declared in `pubspec.yaml`, but that
is a structural check, not a compile guarantee — expect to fix a handful of
API-surface mismatches (Dart/Flutter/plugin version drift) on the first real
`flutter pub get && flutter analyze`.

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
