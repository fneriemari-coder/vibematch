import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'core/api/dio_client.dart';
import 'core/services/notification_service.dart';
import 'core/theme/vibe_match_theme.dart';
import 'data/models/user_models.dart';
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
                return const HomeToggleScreen();
              }
              if (state is AuthUnauthenticated || state is AuthError) {
                return const _LoginScreen();
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

/// Entry screen for signed-out users. Toggles between sign in and sign up:
/// AuthCubit.register() existed from the start but had no UI wired to it, so
/// a fresh visitor hit a login form with no way to create the account it was
/// asking them to log into.
class _LoginScreen extends StatefulWidget {
  const _LoginScreen();

  @override
  State<_LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<_LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();

  bool _isRegistering = false;
  UserRole _role = UserRole.client;
  String _country = 'BR';

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    super.dispose();
  }

  void _submit() {
    final cubit = context.read<AuthCubit>();
    final email = _email.text.trim();
    if (_isRegistering) {
      cubit.register(
        email: email,
        password: _password.text,
        name: _name.text.trim(),
        // The API takes the wire format (CLIENT/PROVIDER/BOTH), not Dart's
        // lower-camel enum name.
        role: _role.name.toUpperCase(),
        country: _country,
      );
    } else {
      cubit.login(email, _password.text);
    }
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
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(SnackBar(content: Text(state.message)));
              }
            },
            builder: (context, state) {
              final loading = state is AuthLoading;
              return ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'VIBE MATCH',
                        style: VibeMatchTextStyles.heading.copyWith(
                          fontSize: 34,
                          letterSpacing: 1,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _isRegistering
                            ? 'Crie sua conta para começar'
                            : 'Entre para continuar',
                        style: VibeMatchTextStyles.body,
                      ),
                      const SizedBox(height: 30),
                      if (_isRegistering) ...[
                        TextField(
                          controller: _name,
                          textCapitalization: TextCapitalization.words,
                          style: const TextStyle(color: Colors.white),
                          decoration: const InputDecoration(
                            labelText: 'Nome completo',
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                      TextField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autocorrect: false,
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(labelText: 'Email'),
                      ),
                      const SizedBox(height: 16),
                      TextField(
                        controller: _password,
                        obscureText: true,
                        style: const TextStyle(color: Colors.white),
                        onSubmitted: (_) => loading ? null : _submit(),
                        decoration: InputDecoration(
                          labelText: 'Senha',
                          helperText:
                              _isRegistering ? 'Mínimo de 8 caracteres' : null,
                          helperStyle: const TextStyle(
                            color: VibeMatchColors.textLow,
                            fontSize: 11,
                          ),
                        ),
                      ),
                      if (_isRegistering) ...[
                        const SizedBox(height: 22),
                        _ChoiceRow<UserRole>(
                          label: 'Você quer',
                          value: _role,
                          options: const {
                            UserRole.client: 'Contratar',
                            UserRole.provider: 'Prestar serviço',
                            UserRole.both: 'Os dois',
                          },
                          onChanged: (v) => setState(() => _role = v),
                        ),
                        const SizedBox(height: 16),
                        _ChoiceRow<String>(
                          label: 'País',
                          value: _country,
                          options: const {'BR': 'Brasil', 'US': 'EUA'},
                          onChanged: (v) => setState(() => _country = v),
                        ),
                      ],
                      const SizedBox(height: 28),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: loading ? null : _submit,
                          child: loading
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Text(
                                  _isRegistering ? 'Criar conta' : 'Entrar',
                                ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      TextButton(
                        onPressed: loading
                            ? null
                            : () => setState(
                                  () => _isRegistering = !_isRegistering,
                                ),
                        child: Text(
                          _isRegistering
                              ? 'Já tenho conta — entrar'
                              : 'Ainda não tenho conta — criar',
                        ),
                      ),
                      if (!_isRegistering)
                        TextButton(
                          onPressed: loading
                              ? null
                              : () => _showForgotPasswordDialog(context),
                          child: const Text('Esqueci minha senha'),
                        ),
                    ],
                  ),
                ),
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
        title: const Text(
          'Esqueci minha senha',
          style: TextStyle(color: Colors.white),
        ),
        content: TextField(
          controller: emailController,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(labelText: 'Email'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancelar'),
          ),
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
                    content: Text(
                      'Se este e-mail existir, enviamos um link de redefinição.',
                    ),
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

/// Segmented selector used on the sign-up form (role, country). Renders the
/// whole option set at once rather than hiding choices behind a dropdown —
/// picking a role is a decision the person makes here, not a field they
/// already know the answer to.
class _ChoiceRow<T> extends StatelessWidget {
  const _ChoiceRow({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final T value;
  final Map<T, String> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: VibeMatchTextStyles.body.copyWith(fontSize: 12.5)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: options.entries.map((entry) {
            final selected = entry.key == value;
            return ChoiceChip(
              label: Text(entry.value),
              selected: selected,
              onSelected: (_) => onChanged(entry.key),
              selectedColor: VibeMatchColors.neonPrimary,
              backgroundColor: VibeMatchColors.surface,
              side: BorderSide(
                color: selected
                    ? VibeMatchColors.neonPrimary
                    : Colors.white.withOpacity(0.12),
              ),
              labelStyle: TextStyle(
                color: selected
                    ? VibeMatchColors.background
                    : VibeMatchColors.textHigh,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                fontSize: 13,
              ),
            );
          }).toList(),
        ),
      ],
    );
  }
}
