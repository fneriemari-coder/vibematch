import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/models/news_models.dart';
import 'vibe_ui.dart';

/// "há 3 h", "há 2 d", "11 de agosto de 2026".
///
/// The feed's whole promise is that it is current, so recency is spelled out in
/// the unit that makes it feel current; anything older than a month is better
/// served by the actual date.
String newsRelativeTime(DateTime? date) {
  if (date == null) return '';
  final difference = DateTime.now().difference(date.toLocal());
  // A source with a clock slightly ahead of ours must not read "há -4 min".
  if (difference.isNegative || difference.inMinutes < 1) return 'agora';
  if (difference.inMinutes < 60) return 'há ${difference.inMinutes} min';
  if (difference.inHours < 24) return 'há ${difference.inHours} h';
  if (difference.inDays < 7) return 'há ${difference.inDays} d';
  if (difference.inDays < 30) return 'há ${difference.inDays ~/ 7} sem';
  return formatFullDate(date);
}

/// Opens an external link. Returns false when there is nothing openable, so the
/// caller can say so instead of leaving a tap with no visible effect.
Future<bool> openNewsUrl(String url) async {
  if (url.isEmpty) return false;
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasScheme) return false;
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}

/// One item of the curated feed, rendered as whichever of the three card
/// treatments its `mediaKind` calls for.
///
/// Articles and video are photo stories — full-bleed 16:9 image, headline over
/// it. A paper is not: it has no photograph worth showing and pretending
/// otherwise produces a stock-image card that says nothing, so it gets a
/// document treatment instead.
class NewsFeedCard extends StatelessWidget {
  const NewsFeedCard({
    super.key,
    required this.item,
    required this.imageUrl,
    required this.onOpen,
    required this.onToggleSave,
  });

  final NewsItem item;

  /// Already routed through `NewsRepository.proxiedImageUrl`; empty when the
  /// item has no artwork.
  final String imageUrl;

  final VoidCallback onOpen;
  final VoidCallback onToggleSave;

  @override
  Widget build(BuildContext context) {
    if (item.isPaper) {
      return _PaperCard(
        item: item,
        onOpen: onOpen,
        onToggleSave: onToggleSave,
      );
    }
    return _MediaCard(
      item: item,
      imageUrl: imageUrl,
      onOpen: onOpen,
      onToggleSave: onToggleSave,
    );
  }
}

/// Article and video. Same skeleton — the video adds a play glyph over the
/// still and points its tap at the clip.
class _MediaCard extends StatelessWidget {
  const _MediaCard({
    required this.item,
    required this.imageUrl,
    required this.onOpen,
    required this.onToggleSave,
  });

  final NewsItem item;
  final String imageUrl;
  final VoidCallback onOpen;
  final VoidCallback onToggleSave;

  @override
  Widget build(BuildContext context) {
    final video = item.isVideo;
    final dateline = _dateline(item);

    return VibeCard(
      onTap: onOpen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 16:9 off the real card width — the picture is the point, so it is
          // never boxed into a fixed thumbnail height.
          LayoutBuilder(
            builder: (context, constraints) => _NewsCover(
              seed: item.id.isEmpty ? item.title : item.id,
              imageUrl: imageUrl,
              height: constraints.maxWidth * 9 / 16,
              icon: video
                  ? Icons.play_circle_outline_rounded
                  : Icons.newspaper_rounded,
              overlay: Stack(
                fit: StackFit.expand,
                children: [
                  if (video)
                    const Center(
                      child: _PlayGlyph(),
                    ),
                  Positioned(
                    left: 14,
                    top: 14,
                    child: Row(
                      children: [
                        if (item.category.isNotEmpty)
                          VibeTag(label: item.categoryLabel, filled: true),
                        if (video) ...[
                          const SizedBox(width: 8),
                          const VibeTag(
                            label: 'Vídeo',
                            icon: Icons.play_arrow_rounded,
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (dateline.isNotEmpty) ...[
                  Text(
                    dateline,
                    style: VibeMatchTextStyles.caption.copyWith(
                      color: VibeMatchColors.scoreGold,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                Text(
                  item.title,
                  style: VibeMatchTextStyles.display(22),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
                if (item.summary.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    item.summary,
                    style: VibeMatchTextStyles.body,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                if (item.author.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    'por ${item.author}',
                    style: VibeMatchTextStyles.caption,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          _CardActions(
            item: item,
            openLabel: video ? 'Assistir' : 'Ler',
            openIcon:
                video ? Icons.play_arrow_rounded : Icons.open_in_new_rounded,
            onOpen: onOpen,
            onToggleSave: onToggleSave,
          ),
        ],
      ),
    );
  }
}

/// A thesis or paper: a document, not a photo story. The gold rule down the
/// left edge is what separates it from the article cards at a glance.
class _PaperCard extends StatelessWidget {
  const _PaperCard({
    required this.item,
    required this.onOpen,
    required this.onToggleSave,
  });

  final NewsItem item;
  final VoidCallback onOpen;
  final VoidCallback onToggleSave;

  @override
  Widget build(BuildContext context) {
    final dateline = _dateline(item);

    return VibeCard(
      onTap: onOpen,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(
            left: BorderSide(color: VibeMatchColors.neonPrimary, width: 3),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const VibeTag(
                        label: 'Tese',
                        icon: Icons.menu_book_rounded,
                      ),
                      if (item.category.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Flexible(child: VibeTag(label: item.categoryLabel)),
                      ],
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(
                    item.title,
                    style: VibeMatchTextStyles.display(21),
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (item.summary.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(
                      item.summary,
                      style: VibeMatchTextStyles.readingBody.copyWith(
                        fontSize: 14,
                        height: 1.6,
                      ),
                      maxLines: 5,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: 12),
                  Text(
                    [
                      if (item.author.isNotEmpty) item.author,
                      if (dateline.isNotEmpty) dateline,
                    ].join('  •  '),
                    style: VibeMatchTextStyles.caption,
                    maxLines: 2,
                  ),
                ],
              ),
            ),
            _CardActions(
              item: item,
              openLabel: 'Ler tese',
              openIcon: Icons.menu_book_rounded,
              onOpen: onOpen,
              onToggleSave: onToggleSave,
            ),
          ],
        ),
      ),
    );
  }
}

/// "Valor Econômico • há 3 h" — the two facts that tell a reader whether an
/// item is worth their attention before they read the headline.
String _dateline(NewsItem item) {
  final time = newsRelativeTime(item.publishedAt);
  final source = item.sourceName;
  if (source.isEmpty) return time;
  if (time.isEmpty) return source;
  return '$source  •  $time';
}

/// The cover: gradient underneath, proxied photograph fading in over it.
///
/// The gradient is not a placeholder that gets thrown away — it stays as the
/// bottom layer, which is what guarantees that a slow, missing or dead image
/// never leaves a hole in the card.
class _NewsCover extends StatelessWidget {
  const _NewsCover({
    required this.seed,
    required this.imageUrl,
    required this.height,
    required this.icon,
    this.overlay,
  });

  final String seed;
  final String imageUrl;
  final double height;
  final IconData icon;
  final Widget? overlay;

  @override
  Widget build(BuildContext context) {
    final fallback = VibeCover(seed: seed, height: height, icon: icon);

    return SizedBox(
      height: height,
      width: double.infinity,
      child: Stack(
        fit: StackFit.expand,
        children: [
          fallback,
          if (imageUrl.isNotEmpty)
            CachedNetworkImage(
              imageUrl: imageUrl,
              fit: BoxFit.cover,
              // Photographs arrive one at a time down a long scroll; popping
              // them in makes the feed feel like it is stuttering.
              fadeInDuration: const Duration(milliseconds: 320),
              fadeOutDuration: const Duration(milliseconds: 120),
              placeholder: (_, __) => fallback,
              errorWidget: (_, __, ___) => fallback,
            ),
          // Scrim so the tags on top of the picture stay legible whatever the
          // photograph happens to be.
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0x66050A0F),
                  Color(0x00050A0F),
                  Color(0x59050A0F)
                ],
                stops: [0, 0.45, 1],
              ),
            ),
          ),
          if (overlay != null) overlay!,
        ],
      ),
    );
  }
}

class _PlayGlyph extends StatelessWidget {
  const _PlayGlyph();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 68,
      width: 68,
      decoration: BoxDecoration(
        color: VibeMatchColors.ink.withOpacity(0.55),
        shape: BoxShape.circle,
        border: Border.all(color: VibeMatchColors.neonPrimary, width: 1.6),
      ),
      child: const Icon(
        Icons.play_arrow_rounded,
        size: 36,
        color: VibeMatchColors.neonPrimary,
      ),
    );
  }
}

/// Save + open, plus the view count. One row, same order on every card, so the
/// bookmark is always in the same place down a long scroll.
class _CardActions extends StatelessWidget {
  const _CardActions({
    required this.item,
    required this.openLabel,
    required this.openIcon,
    required this.onOpen,
    required this.onToggleSave,
  });

  final NewsItem item;
  final String openLabel;
  final IconData openIcon;
  final VoidCallback onOpen;
  final VoidCallback onToggleSave;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 0, 14, 8),
      child: Row(
        children: [
          _ActionButton(
            icon: item.saved
                ? Icons.bookmark_rounded
                : Icons.bookmark_border_rounded,
            label: item.saved ? 'Salvo' : 'Salvar',
            active: item.saved,
            onTap: onToggleSave,
          ),
          _ActionButton(icon: openIcon, label: openLabel, onTap: onOpen),
          const Spacer(),
          if (item.viewsCount > 0)
            Text(
              '${formatCount(item.viewsCount)} leituras',
              style: VibeMatchTextStyles.caption.copyWith(fontSize: 11),
            ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final tone = active ? VibeMatchColors.neonPrimary : VibeMatchColors.textLow;
    return Material(
      color: Colors.transparent,
      borderRadius: VibeMatchRadii.pillRadius,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 17, color: tone),
              const SizedBox(width: 6),
              Text(
                label,
                style: VibeMatchTextStyles.caption.copyWith(
                  color: tone,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
