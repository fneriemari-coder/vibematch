import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';

/// Shared layout primitives for the redesigned app. Every screen composes from
/// these instead of hand-rolling padding and typography, so the "deep navy +
/// gold, editorial, information-dense" language stays consistent as screens are
/// added.

/// Constrains content to a readable measure and applies the standard gutter.
/// On a phone this is just padding; on the web build it stops a 1600px-wide
/// window from stretching a paragraph into an unreadable single line.
class VibeContent extends StatelessWidget {
  const VibeContent({
    super.key,
    required this.child,
    this.maxWidth = VibeMatchSpacing.maxContentWidth,
    this.gutter = VibeMatchSpacing.gutter,
  });

  final Widget child;
  final double maxWidth;
  final double gutter;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: gutter),
          child: child,
        ),
      ),
    );
  }
}

/// Uppercase gold label + serif title, with the emphasised phrase set in
/// italic gold — the reference's signature headline treatment.
class VibeSectionHeader extends StatelessWidget {
  const VibeSectionHeader({
    super.key,
    this.eyebrow,
    required this.title,
    this.titleAccent,
    this.subtitle,
    this.action,
    this.center = false,
  });

  final String? eyebrow;
  final String title;

  /// Rendered italic gold immediately after [title]. Keep it to two or three
  /// words — it is emphasis, not a second sentence.
  final String? titleAccent;
  final String? subtitle;
  final Widget? action;
  final bool center;

  @override
  Widget build(BuildContext context) {
    final alignment =
        center ? CrossAxisAlignment.center : CrossAxisAlignment.start;
    final textAlign = center ? TextAlign.center : TextAlign.start;

    final heading = Column(
      crossAxisAlignment: alignment,
      children: [
        if (eyebrow != null) ...[
          Text(eyebrow!.toUpperCase(), style: VibeMatchTextStyles.eyebrow),
          const SizedBox(height: 10),
        ],
        RichText(
          textAlign: textAlign,
          text: TextSpan(
            style: VibeMatchTextStyles.sectionTitle,
            children: [
              TextSpan(text: title),
              if (titleAccent != null)
                TextSpan(
                  text: ' $titleAccent',
                  style: VibeMatchTextStyles.sectionTitleAccent,
                ),
            ],
          ),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: 8),
          Text(
            subtitle!,
            textAlign: textAlign,
            style: VibeMatchTextStyles.body,
          ),
        ],
      ],
    );

    if (action == null) return heading;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(child: heading),
        const SizedBox(width: 12),
        action!,
      ],
    );
  }
}

/// A single oversized figure with a small trailing unit, over a caption —
/// the "+13MI de seguidores" treatment. The unit is deliberately a separate,
/// much smaller run so the numeral itself carries the whole visual weight.
class VibeStat extends StatelessWidget {
  const VibeStat({
    super.key,
    required this.value,
    this.unit,
    required this.caption,
    this.size = 46,
  });

  final String value;
  final String? unit;
  final String caption;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(value, style: VibeMatchTextStyles.stat(size)),
            if (unit != null)
              Padding(
                padding: EdgeInsets.only(bottom: size * 0.12, left: 2),
                child: Text(
                  unit!,
                  style: VibeMatchTextStyles.stat(size * 0.42),
                ),
              ),
          ],
        ),
        const SizedBox(height: 6),
        Text(caption, style: VibeMatchTextStyles.caption),
      ],
    );
  }
}

/// Small uppercase tag — "AO VIVO", "ONLINE", "ÚLTIMAS VAGAS".
class VibeTag extends StatelessWidget {
  const VibeTag({
    super.key,
    required this.label,
    this.color,
    this.filled = false,
    this.icon,
  });

  final String label;
  final Color? color;
  final bool filled;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final tone = color ?? VibeMatchColors.neonPrimary;
    return Container(
      padding:
          EdgeInsets.symmetric(horizontal: icon != null ? 8 : 9, vertical: 4),
      decoration: BoxDecoration(
        color: filled ? tone : tone.withOpacity(0.12),
        borderRadius: VibeMatchRadii.pillRadius,
        border: Border.all(color: filled ? tone : tone.withOpacity(0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 11, color: filled ? VibeMatchColors.ink : tone),
            const SizedBox(width: 4),
          ],
          Text(
            label.toUpperCase(),
            style: VibeMatchTextStyles.caption.copyWith(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.9,
              color: filled ? VibeMatchColors.ink : tone,
            ),
          ),
        ],
      ),
    );
  }
}

/// Star rating rendered as a numeral rather than five glyphs — denser, and it
/// reads as a score (8.6 / 4.9) the way the reference's programme cards do.
class VibeRating extends StatelessWidget {
  const VibeRating({super.key, required this.rating, this.suffix});

  final double rating;
  final String? suffix;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.star_rounded,
            size: 15, color: VibeMatchColors.scoreGold),
        const SizedBox(width: 3),
        Text(
          rating.toStringAsFixed(1),
          style: VibeMatchTextStyles.caption.copyWith(
            color: VibeMatchColors.textHigh,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (suffix != null) ...[
          const SizedBox(width: 5),
          Text(suffix!, style: VibeMatchTextStyles.caption),
        ],
      ],
    );
  }
}

/// The cover treatment used by every card. Renders [imageUrl] when one exists
/// and falls back to a deterministic gradient keyed off [seed] otherwise —
/// content ships before its art does, and an empty grey box on every card was
/// the single biggest reason the first pass read as unfinished.
class VibeCover extends StatelessWidget {
  const VibeCover({
    super.key,
    required this.seed,
    this.imageUrl,
    this.height = 150,
    this.icon,
    this.overlay,
  });

  final String seed;
  final String? imageUrl;
  final double height;
  final IconData? icon;
  final Widget? overlay;

  @override
  Widget build(BuildContext context) {
    final gradient = VibeMatchColors.coverGradientFor(seed);
    return SizedBox(
      height: height,
      width: double.infinity,
      child: Stack(
        fit: StackFit.expand,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: gradient,
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
          ),
          // Faint monogram so a gradient-only cover still looks designed
          // rather than merely empty.
          if (icon != null)
            Positioned(
              right: -14,
              bottom: -14,
              child: Icon(
                icon,
                size: height * 0.62,
                color: Colors.white.withOpacity(0.07),
              ),
            ),
          if (imageUrl != null && imageUrl!.isNotEmpty)
            Image.network(
              imageUrl!,
              fit: BoxFit.cover,
              // A broken URL must never blank the card — keep the gradient.
              errorBuilder: (_, __, ___) => const SizedBox.shrink(),
            ),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  VibeMatchColors.ink.withOpacity(0.55)
                ],
              ),
            ),
          ),
          if (overlay != null) overlay!,
        ],
      ),
    );
  }
}

/// Standard card shell: hairline border, dark surface, optional tap target.
class VibeCard extends StatelessWidget {
  const VibeCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = EdgeInsets.zero,
    this.highlighted = false,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  /// Gold border — used for the one card in a row that is being pushed.
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: VibeMatchColors.surface,
      borderRadius: VibeMatchRadii.cardRadius,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: VibeMatchRadii.cardRadius,
            border: Border.all(
              color: highlighted
                  ? VibeMatchColors.neonPrimary
                  : VibeMatchColors.border,
              width: highlighted ? 1.4 : 1,
            ),
          ),
          padding: padding,
          child: child,
        ),
      ),
    );
  }
}

/// Horizontal carousel of fixed-width cards. Cards keep a constant width so a
/// row of them scans as a set, and the row peeks the next card to signal that
/// it scrolls.
class VibeCardRail extends StatelessWidget {
  const VibeCardRail({
    super.key,
    required this.itemCount,
    required this.itemBuilder,
    this.cardWidth = 268,
    this.height = 330,
  });

  final int itemCount;
  final Widget Function(BuildContext, int) itemBuilder;
  final double cardWidth;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: VibeMatchSpacing.gutter,
        ),
        itemCount: itemCount,
        separatorBuilder: (_, __) => const SizedBox(width: 14),
        itemBuilder: (context, index) => SizedBox(
          width: cardWidth,
          child: itemBuilder(context, index),
        ),
      ),
    );
  }
}

/// Full-bleed cinematic hero.
///
/// The brief asked for "vídeos interativos no fundo, algo bem profissional e um
/// ambiente de negócios". A real video needs a hosted asset we do not have yet,
/// and a 404'd `<video>` would look far worse than no motion at all — so this
/// renders continuous motion procedurally: two counter-drifting radial light
/// pools over near-black, plus a slow diagonal sheen. It reads as a lit room
/// rather than a flat panel, costs nothing to ship, and never fails to load.
///
/// When a real background clip exists, pass its URL through
/// `--dart-define=HERO_VIDEO_URL` and swap the painter for a `VideoPlayer` —
/// every other part of the layout stays as-is.
class VibeCinematicHero extends StatefulWidget {
  const VibeCinematicHero({
    super.key,
    required this.child,
    this.height = 460,
  });

  final Widget child;
  final double height;

  @override
  State<VibeCinematicHero> createState() => _VibeCinematicHeroState();
}

class _VibeCinematicHeroState extends State<VibeCinematicHero>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 24),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: widget.height,
      width: double.infinity,
      child: Stack(
        fit: StackFit.expand,
        children: [
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: VibeMatchColors.heroGradient,
              ),
            ),
          ),
          // RepaintBoundary keeps the 24s animation from repainting the text
          // and buttons stacked above it on every frame.
          RepaintBoundary(
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, _) => CustomPaint(
                painter: _AmbientLightPainter(_controller.value),
              ),
            ),
          ),
          Align(alignment: Alignment.bottomLeft, child: widget.child),
        ],
      ),
    );
  }
}

class _AmbientLightPainter extends CustomPainter {
  const _AmbientLightPainter(this.t);

  /// Animation position, 0..1.
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final angle = t * 2 * math.pi;

    void pool(Offset centre, double radius, Color colour) {
      canvas.drawCircle(
        centre,
        radius,
        Paint()
          ..shader = RadialGradient(
            colors: [colour, colour.withOpacity(0)],
          ).createShader(Rect.fromCircle(center: centre, radius: radius)),
      );
    }

    // Two pools orbiting in opposite directions — their overlap moves, which
    // is what sells the illusion of a lit space rather than a static gradient.
    pool(
      Offset(
        size.width * (0.24 + 0.16 * math.cos(angle)),
        size.height * (0.32 + 0.12 * math.sin(angle)),
      ),
      size.width * 0.55,
      VibeMatchColors.neonPrimary.withOpacity(0.13),
    );
    pool(
      Offset(
        size.width * (0.78 - 0.14 * math.cos(angle * 0.7)),
        size.height * (0.66 - 0.16 * math.sin(angle * 0.7)),
      ),
      size.width * 0.48,
      VibeMatchColors.slate.withOpacity(0.42),
    );

    // Slow diagonal sheen crossing the frame.
    final sweep = (t * 1.6) % 1.6 - 0.3;
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          stops: [
            (sweep - 0.18).clamp(0.0, 1.0),
            sweep.clamp(0.0, 1.0),
            (sweep + 0.18).clamp(0.0, 1.0),
          ],
          colors: [
            Colors.transparent,
            Colors.white.withOpacity(0.045),
            Colors.transparent,
          ],
        ).createShader(Offset.zero & size),
    );
  }

  @override
  bool shouldRepaint(_AmbientLightPainter oldDelegate) => oldDelegate.t != t;
}

/// Headline that scales between phone and desktop. Splits into a plain leading
/// phrase and an italic gold emphasis, matching `VibeSectionHeader`.
class VibeHeroHeadline extends StatelessWidget {
  const VibeHeroHeadline({super.key, required this.text, this.accent});

  final String text;
  final String? accent;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final size = width < 420
        ? 34.0
        : width < 700
            ? 42.0
            : 56.0;
    return RichText(
      text: TextSpan(
        style: VibeMatchTextStyles.display(size),
        children: [
          TextSpan(text: text),
          if (accent != null)
            TextSpan(
              text: ' $accent',
              style: VibeMatchTextStyles.displayAccent(size),
            ),
        ],
      ),
    );
  }
}

/// Consistent empty state. Never a bare "nada aqui" — always names what will
/// appear and, where there is one, offers the action that fills it.
class VibeEmptyState extends StatelessWidget {
  const VibeEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 48),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: VibeMatchColors.slate),
            const SizedBox(height: 16),
            Text(title, style: VibeMatchTextStyles.subheading),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: VibeMatchTextStyles.body,
            ),
            if (action != null) ...[const SizedBox(height: 20), action!],
          ],
        ),
      ),
    );
  }
}

/// Inline error with a retry, used by every data-backed screen so a failed
/// request never renders as a permanently empty page.
class VibeErrorState extends StatelessWidget {
  const VibeErrorState({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return VibeEmptyState(
      icon: Icons.cloud_off_rounded,
      title: 'Não foi possível carregar',
      message: message,
      action: onRetry == null
          ? null
          : OutlinedButton(
              onPressed: onRetry, child: const Text('Tentar de novo')),
    );
  }
}
