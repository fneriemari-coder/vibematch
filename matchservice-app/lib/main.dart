import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'core/api/dio_client.dart';
import 'core/services/notification_service.dart';
import 'core/theme/vibe_match_theme.dart';
import 'data/repositories/academy_repository.dart';
import 'data/repositories/admin_repository.dart';
import 'data/repositories/auth_repository.dart';
import 'data/repositories/feed_repository.dart';
import 'data/repositories/mastermind_repository.dart';
import 'data/repositories/media_repository.dart';
import 'data/repositories/post_repository.dart';
import 'data/repositories/swipe_repository.dart';
import 'data/repositories/wallet_repository.dart';
import 'logic/auth/auth_cubit.dart';
import 'presentation/screens/home_toggle_screen.dart';
import 'presentation/screens/discovery_feed_screen.dart';
import 'presentation/screens/vibe_academy_screen.dart';
import 'presentation/screens/data_privacy_screen.dart';

final navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase requires platform config files (google-services.json /
  // GoogleService-Info.plist, or FirebaseOptions on web) to be dropped in
  // before this succeeds — see matchservice-app/README.md. Until a real
  // Firebase project is wired up, this throws on every platform; swallow it
  // so the rest of the app (every screen not gated on push notifications)
  // still boots instead of crashing at the splash screen.
  try {
    await Firebase.initializeApp();
  } catch (e) {
    debugPrint('Firebase.initializeApp() failed — push notifications disabled: $e');
  }

  final dioClient = DioClient();
  final authRepository = AuthRepository(dioClient);
  final notificationService = NotificationService(authRepository, navigatorKey: navigatorKey);

  runApp(MatchServiceApp(
    dioClient: dioClient,
    authRepository: authRepository,
    notificationService: notificationService,
  ));
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
      debugPrint('NotificationService.initialize() failed — push notifications disabled: $e');
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
        RepositoryProvider(create: (_) => MastermindRepository(widget.dioClient)),
      ],
      child: BlocProvider(
        create: (context) => AuthCubit(widget.authRepository)..bootstrap(),
        child: MaterialApp(
          navigatorKey: navigatorKey,
          title: 'MatchService',
          debugShowCheckedModeBanner: false,
          theme: buildVibeMatchTheme(),
          onGenerateRoute: (settings) {
            if (settings.name == '/discovery-feed') {
              final args = settings.arguments as Map<String, dynamic>?;
              return MaterialPageRoute(
                builder: (_) => DiscoveryFeedScreen(focusPostId: args?['focusPostId'] as String?),
              );
            }
            if (settings.name == '/privacy') {
              return MaterialPageRoute(
                builder: (_) => DataPrivacyScreen(authRepository: widget.authRepository),
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
                return const HomeToggleScreen();
              }
              if (state is AuthUnauthenticated || state is AuthError) {
                return const _LoginScreen();
              }
              return const Scaffold(
                backgroundColor: VibeMatchColors.background,
                body: Center(child: CircularProgressIndicator(color: VibeMatchColors.neonPrimary)),
              );
            },
          ),
        ),
      ),
    );
  }
}

/// Minimal login screen — enough to drive AuthCubit end to end; a full
/// design pass belongs to a dedicated onboarding flow, out of scope here.
class _LoginScreen extends StatefulWidget {
  const _LoginScreen();

  @override
  State<_LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<_LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: BlocConsumer<AuthCubit, AuthState>(
            listener: (context, state) {
              if (state is AuthError) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(state.message)));
              }
            },
            builder: (context, state) {
              final loading = state is AuthLoading;
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('MatchService', style: VibeMatchTextStyles.heading.copyWith(fontSize: 30)),
                  const SizedBox(height: 32),
                  TextField(
                    controller: _email,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(labelText: 'Senha'),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: loading
                        ? null
                        : () => context.read<AuthCubit>().login(_email.text.trim(), _password.text),
                    child: loading
                        ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Entrar'),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: loading ? null : () => _showForgotPasswordDialog(context),
                    child: const Text('Esqueci minha senha'),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Future<void> _showForgotPasswordDialog(BuildContext context) async {
    final authRepository = context.read<AuthRepository>();
    final emailController = TextEditingController(text: _email.text.trim());

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: VibeMatchColors.surface,
        title: const Text('Esqueci minha senha', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: emailController,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(labelText: 'Email'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancelar')),
          TextButton(
            onPressed: () async {
              final email = emailController.text.trim();
              Navigator.of(dialogContext).pop();
              try {
                await authRepository.forgotPassword(email);
              } catch (_) {
                // Swallow — the backend responds identically whether or not
                // the email exists (see auth.service.ts forgotPassword),
                // so a network error is the only real failure to hide here.
              }
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Se este e-mail existir, enviamos um link de redefinição.'),
                  ),
                );
              }
            },
            child: const Text('Enviar'),
          ),
        ],
      ),
    );
  }
}
