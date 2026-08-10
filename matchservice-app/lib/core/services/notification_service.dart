import 'dart:async';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import '../../data/repositories/auth_repository.dart';

/// Background message handler MUST be a top-level (or static) function —
/// Firebase invokes it in a separate isolate when the app is fully killed.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // No UI work possible here — the OS already renders the system tray
  // notification from `message.notification`. This hook exists so data-only
  // pushes (if ever sent) still get logged/processed if needed later.
}

/// Wraps Firebase Messaging: permission request, token registration with the
/// backend, and the three delivery scenarios the trend-alert push spec cares
/// about — foreground banner, background/terminated tap-to-open, and stale
/// token refresh.
class NotificationService {
  NotificationService(this._authRepository, {required this.navigatorKey});

  final AuthRepository _authRepository;
  final GlobalKey<NavigatorState> navigatorKey;

  final _foregroundMessageController =
      StreamController<RemoteMessage>.broadcast();
  Stream<RemoteMessage> get foregroundMessages =>
      _foregroundMessageController.stream;

  Future<void> initialize() async {
    final messaging = FirebaseMessaging.instance;

    await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );

    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

    await _registerToken();
    messaging.onTokenRefresh.listen((_) => _registerToken());

    // Scenario 1: app in foreground — surface an in-app banner instead of
    // letting the OS show a system notification, so an active swipe session
    // is never interrupted.
    FirebaseMessaging.onMessage.listen((message) {
      _foregroundMessageController.add(message);
    });

    // Scenario 2: app was backgrounded and the user tapped the notification.
    FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);

    // Scenario 3: app was fully terminated and got opened via the notification.
    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage != null) {
      _handleNotificationTap(initialMessage);
    }
  }

  Future<void> _registerToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) {
        await _authRepository.updateFcmToken(token);
      }
    } catch (_) {
      // Expired/unavailable token on this boot — safe to skip, onTokenRefresh
      // or the next app-open cycle will retry.
    }
  }

  void _handleNotificationTap(RemoteMessage message) {
    // AiRetentionNotificationService push ("Seu sistema apresentou um erro de
    // [TAG]?..."): deep-link straight into the VibeAcademyScreen for that
    // course, no intermediate screen — checked first since it's a distinct
    // payload shape from the Discovery Feed trend alert below.
    final courseId = message.data['course_id'];
    final redirect = message.data['redirect'];
    if (courseId != null && redirect == 'VIBE_ACADEMY_COURSE') {
      navigatorKey.currentState?.pushNamed(
        '/vibe-academy',
        arguments: {'courseId': courseId},
      );
      return;
    }

    final postId = message.data['post_id'];
    final modeTarget = message.data['mode_target']; // 'NUVEM' | 'LOCAL'
    if (postId == null) return;

    navigatorKey.currentState?.pushNamed(
      '/discovery-feed',
      arguments: {
        'focusPostId': postId,
        'modeTarget': modeTarget,
        'ctaActive': true,
      },
    );
  }

  void dispose() => _foregroundMessageController.close();
}

/// Discreet, elegant in-app banner for `onMessage` — does not interrupt the
/// active swipe/feed interaction underneath it.
class TrendAlertBanner extends StatelessWidget {
  const TrendAlertBanner({
    super.key,
    required this.title,
    required this.body,
    this.onTap,
  });

  final String title;
  final String body;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFF16161A),
              borderRadius: BorderRadius.circular(14),
              boxShadow: const [
                BoxShadow(color: Colors.black45, blurRadius: 12),
              ],
            ),
            child: Row(
              children: [
                const Icon(Icons.trending_up, color: Color(0xFFF59E0B)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        body,
                        style: const TextStyle(
                          color: Color(0xFF9CA3AF),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
