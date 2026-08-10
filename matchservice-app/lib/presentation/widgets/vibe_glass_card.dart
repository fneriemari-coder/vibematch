import 'dart:ui';
import 'package:flutter/material.dart';
import '../../core/theme/vibe_match_theme.dart';

/// Reusable Cyber-Premium glass panel: blurred backdrop, translucent
/// amethyst fill, thin neon-cyan border. Used behind portfolio/swipe cards
/// and any surface that should read as "glass" rather than flat.
///
/// [highlighted] switches the border to full-opacity neon — wire it to a
/// drag-gesture callback (e.g. `onPanStart`) so the card lights up the
/// instant the user starts swiping it, per the VIBE MATCH micro-interaction
/// spec.
class VibeGlassCard extends StatelessWidget {
  const VibeGlassCard({
    super.key,
    required this.child,
    this.borderRadius,
    this.highlighted = false,
    this.padding = const EdgeInsets.all(16),
  });

  final Widget child;
  final BorderRadius? borderRadius;
  final bool highlighted;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final radius = borderRadius ?? VibeMatchRadii.cardRadius;

    return ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 15, sigmaY: 15),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: padding,
          decoration: BoxDecoration(
            color: VibeMatchColors.surface.withOpacity(0.6),
            borderRadius: radius,
            border: Border.all(
              color: VibeMatchColors.neonPrimary.withOpacity(
                highlighted ? 1.0 : 0.5,
              ),
              width: 1,
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}
