import 'package:flutter/material.dart';
import '../../data/models/wallet_models.dart';
import '../../core/theme/vibe_match_theme.dart';

Color _colorFor(TimelineStatus status) => switch (status) {
  TimelineStatus.verifying => const Color(
    0xFFFFD60A,
  ), // yellow — Verificando por IA
  TimelineStatus.approved => const Color(0xFF10B981), // green — Aprovado e Pago
  TimelineStatus.disputed => const Color(0xFFEF4444), // red — Em disputa
  TimelineStatus.failed => const Color(0xFFEF4444),
  TimelineStatus.scheduled => VibeMatchColors.textLow,
};

String labelFor(TimelineStatus status) => switch (status) {
  TimelineStatus.verifying => 'Verificando por IA',
  TimelineStatus.approved => 'Aprovado e Pago',
  TimelineStatus.disputed => 'Em disputa',
  TimelineStatus.failed => 'Falhou',
  TimelineStatus.scheduled => 'Agendado',
};

/// Circular status indicator for the wallet timeline. Only VERIFYING pulses
/// (an AI audit is actively in flight) — every other state is a fixed dot,
/// since pulsing a resolved state would read as "still working on it".
class PulsingStatusDot extends StatefulWidget {
  const PulsingStatusDot({super.key, required this.status, this.size = 12});

  final TimelineStatus status;
  final double size;

  @override
  State<PulsingStatusDot> createState() => _PulsingStatusDotState();
}

class _PulsingStatusDotState extends State<PulsingStatusDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = _colorFor(widget.status);
    if (widget.status != TimelineStatus.verifying) {
      return Container(
        width: widget.size,
        height: widget.size,
        decoration: BoxDecoration(shape: BoxShape.circle, color: color),
      );
    }
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final opacity = 0.4 + (_controller.value * 0.6);
        return Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color.withOpacity(opacity),
            boxShadow: [
              BoxShadow(
                color: color.withOpacity(opacity * 0.6),
                blurRadius: 6,
                spreadRadius: 1,
              ),
            ],
          ),
        );
      },
    );
  }
}
