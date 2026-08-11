import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/api/dio_client.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/chat_models.dart';
import '../../data/repositories/chat_repository.dart';
import '../../data/repositories/escrow_repository.dart';
import '../../logic/auth/auth_cubit.dart';
import 'create_deal_screen.dart';

/// Instant-match celebration screen — success animation + the CTA that starts
/// the escrow-backed contract.
///
/// That CTA used to push a named route, `/escrow/new`, that no `onGenerateRoute`
/// ever handled: the button did nothing at all. It now opens `CreateDealScreen`
/// directly.
class MatchSuccessScreen extends StatefulWidget {
  const MatchSuccessScreen({
    super.key,
    required this.otherUserName,
    required this.matchId,
    this.otherUserId,
  });

  final String otherUserName;
  final String matchId;

  /// The counterpart's user id, needed to open a contract. Optional because
  /// the deck — which is where this screen is pushed from — does not carry it;
  /// when it is missing the screen resolves it from the match itself.
  final String? otherUserId;

  @override
  State<MatchSuccessScreen> createState() => _MatchSuccessScreenState();
}

class _MatchSuccessScreenState extends State<MatchSuccessScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scale;

  /// Resolved from the match. `SwipeCubit` puts the swiped user's *id* in the
  /// name slot, so without this the celebration greets the user by uuid.
  String? _resolvedName;
  String? _resolvedId;
  bool _resolving = true;

  String get _displayName => _resolvedName ?? widget.otherUserName;
  String? get _counterpartId => widget.otherUserId ?? _resolvedId;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _scale = CurvedAnimation(parent: _controller, curve: Curves.elasticOut);
    _controller.forward();
    _resolveCounterpart();
  }

  /// Best effort: the conversations endpoint already returns the other side's
  /// id and name for every active match, so one call fills in both. A failure
  /// is silent — the celebration still stands, only the contract CTA is held
  /// back, and it says why.
  Future<void> _resolveCounterpart() async {
    if (widget.otherUserId != null) {
      setState(() => _resolving = false);
      return;
    }
    try {
      final conversations =
          await context.read<ChatRepository>().listConversations();
      if (!mounted) return;
      Conversation? match;
      for (final conversation in conversations) {
        if (conversation.matchId == widget.matchId) {
          match = conversation;
          break;
        }
      }
      setState(() {
        _resolvedId = match?.otherUserId;
        _resolvedName = match?.otherUserName;
        _resolving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _resolving = false);
    }
  }

  void _startContract() {
    final auth = context.read<AuthCubit>().state;
    final counterpartId = _counterpartId;
    if (auth is! AuthAuthenticated ||
        counterpartId == null ||
        counterpartId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Não conseguimos abrir o contrato agora. Tente pela lista de '
            'conversas.',
          ),
        ),
      );
      return;
    }

    Navigator.of(context).push(
      MaterialPageRoute<bool>(
        builder: (_) => CreateDealScreen(
          // EscrowRepository is not in main.dart's provider list yet, so it is
          // built from the shared DioClient. See the report.
          escrowRepository: EscrowRepository(context.read<DioClient>()),
          matchId: widget.matchId,
          // Whoever swiped is the one hiring: the deck only ever shows
          // providers, so the viewer is the client.
          clientId: auth.user.id,
          providerId: counterpartId,
          counterpartName: _resolvedName,
          initialCurrency: auth.user.isBrazil ? 'BRL' : 'USD',
        ),
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ScaleTransition(
              scale: _scale,
              child: Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    colors: VibeMatchColors.ctaGradient,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: VibeMatchColors.neonPrimary.withOpacity(0.5),
                      blurRadius: 30,
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.handshake_rounded,
                  color: VibeMatchColors.ink,
                  size: 56,
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'Deu match!',
              style: VibeMatchTextStyles.heading.copyWith(fontSize: 26),
            ),
            const SizedBox(height: 8),
            Text(
              'Você e $_displayName podem começar agora.',
              textAlign: TextAlign.center,
              style: VibeMatchTextStyles.body,
            ),
            const SizedBox(height: 36),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _resolving ? null : _startContract,
                  child: _resolving
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Fechar negócio com custódia'),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 40),
              child: Text(
                'O valor combinado fica retido pela plataforma e só é liberado '
                'quando você aprovar a entrega.',
                textAlign: TextAlign.center,
                style: VibeMatchTextStyles.caption,
              ),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Continuar navegando'),
            ),
          ],
        ),
      ),
    );
  }
}
