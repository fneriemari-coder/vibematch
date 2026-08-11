import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/vibe_match_theme.dart';

/// The VIBE MATCH mark.
///
/// Two triangles meeting inside a diamond: one solid, one outlined. The product
/// is dual opt-in — a match only exists when both sides say yes — so the mark is
/// two halves that only read as a whole shape together. Drawn rather than
/// shipped as an asset so it stays crisp at every size and can be recoloured
/// for light backgrounds without a second file.
class VibeLogoMark extends StatelessWidget {
  const VibeLogoMark({super.key, this.size = 32, this.color, this.accent});

  final double size;

  /// Outline half. Defaults to the gold accent.
  final Color? color;

  /// Solid half. Defaults to the lighter gold.
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _LogoMarkPainter(
          outline: color ?? VibeMatchColors.neonPrimary,
          solid: accent ?? VibeMatchColors.scoreGold,
        ),
      ),
    );
  }
}

class _LogoMarkPainter extends CustomPainter {
  const _LogoMarkPainter({required this.outline, required this.solid});

  final Color outline;
  final Color solid;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final stroke = w * 0.075;

    // Enclosing diamond.
    final diamond = Path()
      ..moveTo(w / 2, stroke / 2)
      ..lineTo(w - stroke / 2, h / 2)
      ..lineTo(w / 2, h - stroke / 2)
      ..lineTo(stroke / 2, h / 2)
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
      ..moveTo(w * 0.5, h * 0.30)
      ..lineTo(w * 0.5, h * 0.78)
      ..lineTo(w * 0.24, h * 0.5)
      ..close();
    canvas.drawPath(solidHalf, Paint()..color = solid);

    // Upper-right half, outlined — the side still deciding.
    final outlineHalf = Path()
      ..moveTo(w * 0.5, h * 0.22)
      ..lineTo(w * 0.76, h * 0.5)
      ..lineTo(w * 0.5, h * 0.70)
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
      oldDelegate.outline != outline || oldDelegate.solid != solid;
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
  });

  final double markSize;
  final double fontSize;
  final bool onDark;
  final bool showWordmark;

  @override
  Widget build(BuildContext context) {
    final base =
        onDark ? VibeMatchColors.textHigh : VibeMatchColors.textOnCream;
    final mark = VibeLogoMark(size: markSize);
    if (!showWordmark) return mark;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        mark,
        SizedBox(width: markSize * 0.34),
        Text.rich(
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
        ),
      ],
    );
  }
}
