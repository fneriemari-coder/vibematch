import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/vibe_match_theme.dart';

/// The VIBE MATCH mark.
///
/// Two readings, one shape.
///
/// **The core** is two triangles meeting inside a diamond — one solid, one
/// outlined. The product is dual opt-in: a match only exists when both sides
/// say yes, so the mark is two halves that only close the form together. That
/// moment, the agreement, is the centre of everything the platform does.
///
/// **The orbit** is what makes it an ecosystem rather than a directory. Four
/// nodes ride a ring around the core — contratar, aprender, financiar,
/// pertencer — because a deal here is not an endpoint. It is surrounded by the
/// education that prepares it, the capital that funds it, and the community
/// that keeps the people in orbit after it closes. Remove any node and the
/// ring is still there; remove the core and there is nothing to orbit.
///
/// Drawn rather than shipped as an asset so it stays crisp at every size and
/// can be recoloured for light backgrounds without a second file. Below about
/// 22px the orbit is dropped — at favicon sizes the ring turns to mud and the
/// core alone is the more legible mark.
class VibeLogoMark extends StatelessWidget {
  const VibeLogoMark({
    super.key,
    this.size = 32,
    this.color,
    this.accent,
    this.showOrbit = true,
  });

  final double size;

  /// Outline half and the orbit ring. Defaults to the gold accent.
  final Color? color;

  /// Solid half and the orbit nodes. Defaults to the lighter gold.
  final Color? accent;

  /// Set false for a tight, core-only lockup (app icon, dense toolbars).
  final bool showOrbit;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _LogoMarkPainter(
          outline: color ?? VibeMatchColors.neonPrimary,
          solid: accent ?? VibeMatchColors.scoreGold,
          orbit: showOrbit && size >= 22,
        ),
      ),
    );
  }
}

class _LogoMarkPainter extends CustomPainter {
  const _LogoMarkPainter({
    required this.outline,
    required this.solid,
    required this.orbit,
  });

  final Color outline;
  final Color solid;
  final bool orbit;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final centre = Offset(w / 2, h / 2);

    // The orbit sits outside the core, so the core shrinks to make room for
    // it. Without this the ring would crop against the bounding box.
    final coreScale = orbit ? 0.66 : 1.0;
    final stroke = w * 0.075 * coreScale;

    if (orbit) {
      final radius = w * 0.46;
      canvas.drawCircle(
        centre,
        radius,
        Paint()
          ..color = outline.withOpacity(0.38)
          ..style = PaintingStyle.stroke
          ..strokeWidth = w * 0.035,
      );

      // Four nodes on the diagonals — the diamond's points already occupy the
      // cardinal directions, and stacking them there would read as noise.
      for (var i = 0; i < 4; i++) {
        final angle = math.pi / 4 + i * math.pi / 2;
        canvas.drawCircle(
          centre + Offset(math.cos(angle), math.sin(angle)) * radius,
          w * 0.062,
          Paint()..color = solid,
        );
      }
    }

    double x(double t) => centre.dx + (t - 0.5) * w * coreScale;
    double y(double t) => centre.dy + (t - 0.5) * h * coreScale;

    // Enclosing diamond.
    final diamond = Path()
      ..moveTo(x(0.5), y(0.03))
      ..lineTo(x(0.97), y(0.5))
      ..lineTo(x(0.5), y(0.97))
      ..lineTo(x(0.03), y(0.5))
      ..close();
    canvas.drawPath(
      diamond,
      Paint()
        ..color = outline
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeJoin = StrokeJoin.miter,
    );

    // Lower-left half, solid — the side that has already committed.
    final solidHalf = Path()
      ..moveTo(x(0.5), y(0.30))
      ..lineTo(x(0.5), y(0.78))
      ..lineTo(x(0.24), y(0.5))
      ..close();
    canvas.drawPath(solidHalf, Paint()..color = solid);

    // Upper-right half, outlined — the side still deciding.
    final outlineHalf = Path()
      ..moveTo(x(0.5), y(0.22))
      ..lineTo(x(0.76), y(0.5))
      ..lineTo(x(0.5), y(0.70))
      ..close();
    canvas.drawPath(
      outlineHalf,
      Paint()
        ..color = outline
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke * 0.85
        ..strokeJoin = StrokeJoin.miter,
    );
  }

  @override
  bool shouldRepaint(_LogoMarkPainter oldDelegate) =>
      oldDelegate.outline != outline ||
      oldDelegate.solid != solid ||
      oldDelegate.orbit != orbit;
}

/// Mark + wordmark. "VIBE" in the text colour, "MATCH" in gold — the second
/// word is the promise, so it carries the accent.
class VibeLogo extends StatelessWidget {
  const VibeLogo({
    super.key,
    this.markSize = 30,
    this.fontSize = 17,
    this.onDark = true,
    this.showWordmark = true,
    this.showOrbit = true,
    this.tagline,
  });

  final double markSize;
  final double fontSize;
  final bool onDark;
  final bool showWordmark;
  final bool showOrbit;

  /// Optional line under the wordmark. Use it where the brand needs to explain
  /// itself — a first screen, a share card — and nowhere else.
  final String? tagline;

  @override
  Widget build(BuildContext context) {
    final base =
        onDark ? VibeMatchColors.textHigh : VibeMatchColors.textOnCream;
    final mark = VibeLogoMark(size: markSize, showOrbit: showOrbit);
    if (!showWordmark) return mark;

    final wordmark = Text.rich(
      TextSpan(
        style: GoogleFonts.inter(
          fontSize: fontSize,
          fontWeight: FontWeight.w700,
          letterSpacing: fontSize * 0.16,
          color: base,
        ),
        children: [
          const TextSpan(text: 'VIBE '),
          TextSpan(
            text: 'MATCH',
            style: const TextStyle(color: VibeMatchColors.neonPrimary),
          ),
        ],
      ),
    );

    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        mark,
        SizedBox(width: markSize * 0.34),
        if (tagline == null)
          wordmark
        else
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              wordmark,
              SizedBox(height: fontSize * 0.22),
              Text(
                tagline!.toUpperCase(),
                style: GoogleFonts.inter(
                  fontSize: fontSize * 0.5,
                  fontWeight: FontWeight.w500,
                  letterSpacing: fontSize * 0.11,
                  color: onDark
                      ? VibeMatchColors.textLow
                      : VibeMatchColors.textOnCreamLow,
                ),
              ),
            ],
          ),
      ],
    );
  }
}
