import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;

/// Firebase configuration for the `vibematch-42981` project.
///
/// These values are not secrets. A Firebase web config is shipped inside every
/// client bundle by design and is readable by anyone who loads the page —
/// access is controlled by security rules and App Check, not by hiding the
/// config. The service-account key is the credential that must stay private,
/// and that one lives only in the API's `FIREBASE_SERVICE_ACCOUNT_JSON`
/// environment variable, never here.
///
/// Only the Web app is registered so far. Android and iOS throw a directed
/// error rather than silently falling back to the web config, which would fail
/// later with a much less obvious message.
class DefaultFirebaseOptions {
  DefaultFirebaseOptions._();

  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        throw UnsupportedError(
          'Nenhum app Android registrado no projeto Firebase vibematch-42981. '
          'Adicione um app Android no console (google-services.json) e '
          'preencha DefaultFirebaseOptions.android.',
        );
      case TargetPlatform.iOS:
      case TargetPlatform.macOS:
        throw UnsupportedError(
          'Nenhum app iOS registrado no projeto Firebase vibematch-42981. '
          'Adicione um app iOS no console (GoogleService-Info.plist) e '
          'preencha DefaultFirebaseOptions.ios.',
        );
      default:
        throw UnsupportedError(
          'Firebase não está configurado para $defaultTargetPlatform.',
        );
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyD9NZauoLfMxvDugu0DZe99_0mVf6-Lpgw',
    appId: '1:15459176528:web:2317cc953ca8b26ca00155',
    messagingSenderId: '15459176528',
    projectId: 'vibematch-42981',
    authDomain: 'vibematch-42981.firebaseapp.com',
    storageBucket: 'vibematch-42981.firebasestorage.app',
    measurementId: 'G-6PNV1CDYXF',
  );
}

/// Web push needs the VAPID public key from
/// Console → Configurações do projeto → Cloud Messaging → Certificados push da Web.
///
/// Passed at build time (`--dart-define=FIREBASE_VAPID_KEY=B...`) rather than
/// hardcoded, so rotating the key pair is a redeploy and not a code change.
/// While it is empty, `FirebaseMessaging.getToken()` on web is skipped
/// entirely — calling it without a key throws and would otherwise surface as a
/// mysterious failure on every app boot.
const String firebaseVapidKey =
    String.fromEnvironment('FIREBASE_VAPID_KEY', defaultValue: '');
