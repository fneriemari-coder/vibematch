import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'core/api/dio_client.dart';
import 'firebase_options.dart';
import 'core/services/notification_service.dart';
import 'core/theme/vibe_match_theme.dart';
import 'data/repositories/academy_repository.dart';
import 'data/repositories/admin_repository.dart';
import 'data/repositories/auth_repository.dart';
import 'data/repositories/chat_repository.dart';
import 'data/repositories/community_repository.dart';
import 'data/repositories/content_repository.dart';
import 'data/repositories/feed_repository.dart';
import 'data/repositories/mastermind_repository.dart';
import 'data/repositories/media_repository.dart';
import 'data/repositories/post_repository.dart';
import 'data/repositories/swipe_repository.dart';
import 'data/repositories/wallet_repository.dart';
import 'logic/auth/auth_cubit.dart';
import 'presentation/screens/app_shell.dart';
import 'presentation/screens/discovery_feed_screen.dart';
import 'presentation/screens/vibe_academy_screen.dart';
import 'presentation/screens/auth_screen.dart';
import 'presentation/screens/data_privacy_screen.dart';

final navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // The web app is registered against the vibematch-42981 project; Android
  // and iOS are not, and DefaultFirebaseOptions throws a directed error for
  // them. Keep swallowing that — push is the only thing that depends on
  // Firebase, and no screen should fail to boot because of it.
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (e) {
    debugPrint(
      'Firebase.initializeApp() failed — push notifications disabled: $e',
    );
  }

  final dioClient = DioClient();
  final authRepository = AuthRepository(dioClient);
  final notificationService = NotificationService(
    authRepository,
    navigatorKey: navigatorKey,
  );

  runApp(
    MatchServiceApp(
      dioClient: dioClient,
      authRepository: authRepository,
      notificationService: notificationService,
    ),
  );
}

class MatchServiceApp extends StatefulWidget {
  const MatchServiceApp({
    super.key,
    required this.dioClient,
    required this.authRepository,
    required this.notificationService,
  });

  final DioClient dioClient;
  final AuthRepository authRepository;
  final NotificationService notificationService;

  @override
  State<MatchServiceApp> createState() => _MatchServiceAppState();
}

class _MatchServiceAppState extends State<MatchServiceApp> {
  @override
  void initState() {
    super.initState();
    // Same story as Firebase.initializeApp() above — without a configured
    // Firebase project this throws immediately (FirebaseMessaging.instance
    // needs an initialized app); don't let that take the rest of the UI down.
    widget.notificationService.initialize().catchError((e) {
      debugPrint(
        'NotificationService.initialize() failed — push notifications disabled: $e',
      );
    });
    widget.notificationService.foregroundMessages.listen((message) {
      final banner = message.notification;
      if (banner == null) return;
      ScaffoldMessenger.of(navigatorKey.currentContext!).showSnackBar(
        SnackBar(content: Text('${banner.title}\n${banner.body}')),
      );
    });
  }

  @override
  void dispose() {
    widget.notificationService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiRepositoryProvider(
      providers: [
        RepositoryProvider.value(value: widget.dioClient),
        RepositoryProvider.value(value: widget.authRepository),
        RepositoryProvider(create: (_) => SwipeRepository(widget.dioClient)),
        RepositoryProvider(create: (_) => FeedRepository(widget.dioClient)),
        RepositoryProvider(create: (_) => WalletRepository(widget.dioClient)),
        RepositoryProvider(create: (_) => PostRepository(widget.dioClient)),
        RepositoryProvider(create: (_) => AdminRepository(widget.dioClient)),
        RepositoryProvider(create: (_) => AcademyRepository(widget.dioClient)),
        RepositoryProvider(create: (_) => MediaRepository(widget.dioClient)),
        RepositoryProvider(
          create: (_) => MastermindRepository(widget.dioClient),
        ),
        RepositoryProvider(create: (_) => ChatRepository(widget.dioClient)),
        RepositoryProvider(create: (_) => ContentRepository(widget.dioClient)),
        RepositoryProvider(
          create: (_) => CommunityRepository(widget.dioClient),
        ),
      ],
      child: BlocProvider(
        create: (context) => AuthCubit(widget.authRepository)..bootstrap(),
        child: MaterialApp(
          navigatorKey: navigatorKey,
          title: 'VIBE MATCH',
          debugShowCheckedModeBanner: false,
          theme: buildVibeMatchTheme(),
          onGenerateRoute: (settings) {
            if (settings.name == '/discovery-feed') {
              final args = settings.arguments as Map<String, dynamic>?;
              return MaterialPageRoute(
                builder: (_) => DiscoveryFeedScreen(
                  focusPostId: args?['focusPostId'] as String?,
                ),
              );
            }
            if (settings.name == '/privacy') {
              return MaterialPageRoute(
                builder: (_) =>
                    DataPrivacyScreen(authRepository: widget.authRepository),
              );
            }
            if (settings.name == '/vibe-academy') {
              final args = settings.arguments as Map<String, dynamic>?;
              final courseId = args?['courseId'] as String?;
              if (courseId == null) return null;
              return MaterialPageRoute(
                builder: (_) => VibeAcademyScreen(
                  courseId: courseId,
                  academyRepository: AcademyRepository(widget.dioClient),
                ),
              );
            }
            return null;
          },
          home: BlocBuilder<AuthCubit, AuthState>(
            builder: (context, state) {
              if (state is AuthAuthenticated) {
                return const AppShell();
              }
              if (state is AuthUnauthenticated || state is AuthError) {
                return AuthScreen(authRepository: widget.authRepository);
              }
              return const Scaffold(
                backgroundColor: VibeMatchColors.background,
                body: Center(
                  child: CircularProgressIndicator(
                    color: VibeMatchColors.neonPrimary,
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
