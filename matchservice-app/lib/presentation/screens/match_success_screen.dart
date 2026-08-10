import 'package:flutter/material.dart';
import '../../core/theme/vibe_match_theme.dart';

/// Instant-match celebration screen — success animation + the CTA that
/// starts the Escrow-backed contract flow.
class MatchSuccessScreen extends StatefulWidget {
  const MatchSuccessScreen({
    super.key,
    required this.otherUserName,
    required this.matchId,
  });

  final String otherUserName;
  final String matchId;

  @override
  State<MatchSuccessScreen> createState() => _MatchSuccessScreenState();
}

class _MatchSuccessScreenState extends State<MatchSuccessScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scale;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _scale = CurvedAnimation(parent: _controller, curve: Curves.elasticOut);
    _controller.forward();
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
                    colors: [Color(0xFF6366F1), Color(0xFF06B6D4)],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: VibeMatchColors.neonPrimary.withOpacity(0.5),
                      blurRadius: 30,
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.favorite,
                  color: Colors.white,
                  size: 56,
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              "It's a Match!",
              style: VibeMatchTextStyles.heading.copyWith(fontSize: 26),
            ),
            const SizedBox(height: 8),
            Text(
              'Você e ${widget.otherUserName} podem começar agora.',
              style: VibeMatchTextStyles.body,
            ),
            const SizedBox(height: 36),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: VibeMatchColors.neonPrimary,
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                  onPressed: () => Navigator.of(
                    context,
                  ).pushNamed('/escrow/new', arguments: widget.matchId),
                  child: const Text(
                    'Start Contract with Secure Escrow',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text(
                'Continuar navegando',
                style: TextStyle(color: VibeMatchColors.textLow),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
