import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/user_models.dart';
import '../../data/repositories/auth_repository.dart';
import '../../logic/auth/auth_cubit.dart';
import '../widgets/vibe_logo.dart';
import '../widgets/vibe_ui.dart';

/// Sign in / sign up.
///
/// Split screen: a full-bleed cinematic panel carries the positioning, the
/// right-hand panel carries the form. Below 900px the panel collapses to a
/// compact banner above the form rather than disappearing — the headline is the
/// only thing that tells a first-time visitor what this place is.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.authRepository});

  final AuthRepository authRepository;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
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
    final isWide = MediaQuery.sizeOf(context).width >= 900;

    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      body: isWide
          ? Row(
              children: [
                const Expanded(flex: 5, child: _BrandPanel()),
                Expanded(
                  flex: 4,
                  child: SafeArea(child: _formPanel(scrollable: true)),
                ),
              ],
            )
          : SafeArea(
              child: SingleChildScrollView(
                child: Column(
                  children: [
                    const _BrandPanel(compact: true),
                    _formPanel(scrollable: false),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _formPanel({required bool scrollable}) {
    final form = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 36),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
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
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: VibeLogo(markSize: 34, fontSize: 18),
                  ),
                  const SizedBox(height: 34),
                  Text(
                    _isRegistering ? 'Criar sua conta' : 'Bem-vindo de volta',
                    style: VibeMatchTextStyles.sectionTitle,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _isRegistering
                        ? 'Leva menos de um minuto. Você escolhe se quer contratar, prestar serviço, ou os dois.'
                        : 'Entre para retomar suas conversas, cursos e negociações.',
                    style: VibeMatchTextStyles.body,
                  ),
                  const SizedBox(height: 30),
                  if (_isRegistering) ...[
                    TextField(
                      controller: _name,
                      textCapitalization: TextCapitalization.words,
                      style: const TextStyle(color: VibeMatchColors.textHigh),
                      decoration: const InputDecoration(
                        labelText: 'Nome completo',
                      ),
                    ),
                    const SizedBox(height: 14),
                  ],
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    style: const TextStyle(color: VibeMatchColors.textHigh),
                    decoration: const InputDecoration(labelText: 'E-mail'),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    style: const TextStyle(color: VibeMatchColors.textHigh),
                    onSubmitted: (_) => loading ? null : _submit(),
                    decoration: InputDecoration(
                      labelText: 'Senha',
                      helperText:
                          _isRegistering ? 'Mínimo de 8 caracteres' : null,
                      helperStyle: VibeMatchTextStyles.caption.copyWith(
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
                  const SizedBox(height: 26),
                  ElevatedButton(
                    onPressed: loading ? null : _submit,
                    child: loading
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: VibeMatchColors.ink,
                            ),
                          )
                        : Text(
                            _isRegistering ? 'Criar conta' : 'Entrar',
                          ),
                  ),
                  const SizedBox(height: 6),
                  TextButton(
                    onPressed: loading
                        ? null
                        : () =>
                            setState(() => _isRegistering = !_isRegistering),
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
              );
            },
          ),
        ),
      ),
    );

    // In the wide layout this panel is the only scrollable region; in the
    // narrow one an outer SingleChildScrollView already scrolls the whole
    // page, and nesting a second scrollable inside it would break the fling.
    return scrollable ? SingleChildScrollView(child: form) : form;
  }

  Future<void> _showForgotPasswordDialog(BuildContext context) async {
    final authRepository = widget.authRepository;
    final emailController = TextEditingController(text: _email.text.trim());

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: VibeMatchColors.surface,
        title:
            Text('Esqueci minha senha', style: VibeMatchTextStyles.subheading),
        content: TextField(
          controller: emailController,
          style: const TextStyle(color: VibeMatchColors.textHigh),
          decoration: const InputDecoration(labelText: 'E-mail'),
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

/// The cinematic half. Positioning statement plus what the platform actually
/// does — deliberately three real capabilities rather than client logos or
/// headline metrics, because we do not have either yet and inventing them would
/// put a lie on the first screen anyone sees.
class _BrandPanel extends StatelessWidget {
  const _BrandPanel({this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return VibeCinematicHero(
      height: compact ? 300 : MediaQuery.sizeOf(context).height,
      child: Padding(
        padding:
            EdgeInsets.fromLTRB(compact ? 24 : 48, 0, compact ? 24 : 48, 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const VibeLogo(
              markSize: 40,
              fontSize: 18,
              tagline: 'Ecossistema de negócios',
            ),
            SizedBox(height: compact ? 22 : 34),
            VibeHeroHeadline(
              text: 'Onde quem contrata e quem entrega',
              accent: 'fecham negócio.',
            ),
            SizedBox(height: compact ? 14 : 20),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Text(
                'Um match só acontece quando os dois lados dizem sim. '
                'Depois disso, o contrato, o pagamento e a entrega '
                'acontecem aqui dentro.',
                style: VibeMatchTextStyles.body.copyWith(fontSize: 15),
              ),
            ),
            if (!compact) ...[
              const SizedBox(height: 40),
              const _PillarRow(
                icon: Icons.handshake_outlined,
                title: 'Contrate com garantia',
                detail: 'Escrow, marcos e liberação por entrega validada.',
              ),
              const SizedBox(height: 18),
              const _PillarRow(
                icon: Icons.school_outlined,
                title: 'Aprenda com quem executa',
                detail: 'Cursos, mentorias ao vivo e comunidades por convite.',
              ),
              const SizedBox(height: 18),
              const _PillarRow(
                icon: Icons.trending_up_rounded,
                title: 'Construa reputação',
                detail:
                    'K-Score público, medido por entrega — não por seguidores.',
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PillarRow extends StatelessWidget {
  const _PillarRow({
    required this.icon,
    required this.title,
    required this.detail,
  });

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          height: 38,
          width: 38,
          decoration: BoxDecoration(
            color: VibeMatchColors.neonPrimary.withOpacity(0.12),
            borderRadius: VibeMatchRadii.pillRadius,
            border: Border.all(
              color: VibeMatchColors.neonPrimary.withOpacity(0.35),
            ),
          ),
          child: Icon(icon, size: 18, color: VibeMatchColors.neonPrimary),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: VibeMatchTextStyles.subheading),
              const SizedBox(height: 2),
              Text(detail, style: VibeMatchTextStyles.caption),
            ],
          ),
        ),
      ],
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
        Text(label.toUpperCase(), style: VibeMatchTextStyles.eyebrow),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: options.entries.map((entry) {
            final selected = entry.key == value;
            return ChoiceChip(
              label: Text(entry.value),
              selected: selected,
              showCheckmark: false,
              onSelected: (_) => onChanged(entry.key),
              selectedColor: VibeMatchColors.neonPrimary,
              backgroundColor: VibeMatchColors.surface,
              side: BorderSide(
                color: selected
                    ? VibeMatchColors.neonPrimary
                    : VibeMatchColors.border,
              ),
              labelStyle: VibeMatchTextStyles.caption.copyWith(
                color:
                    selected ? VibeMatchColors.ink : VibeMatchColors.textHigh,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                fontSize: 13,
              ),
            );
          }).toList(),
        ),
      ],
    );
  }
}
