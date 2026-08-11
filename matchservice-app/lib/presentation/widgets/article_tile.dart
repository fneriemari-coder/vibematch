import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/content_models.dart';
import 'vibe_ui.dart';

/// One article as a card. Shared by the editorial grid and the "Leia também"
/// rail on a detail page so a piece looks identical wherever it is surfaced.
class ArticleTile extends StatelessWidget {
  const ArticleTile({
    super.key,
    required this.article,
    required this.onTap,
    this.coverHeight = 160,
    this.excerptLines = 2,
  });

  final ArticleCard article;
  final VoidCallback onTap;
  final double coverHeight;
  final int excerptLines;

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          VibeCover(
            seed: article.slug,
            imageUrl: article.coverImageUrl,
            height: coverHeight,
            icon: Icons.article_rounded,
            overlay: article.aiGenerated
                ? Align(
                    alignment: Alignment.topRight,
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: VibeTag(
                        label: 'IA',
                        filled: true,
                        icon: Icons.auto_awesome_rounded,
                      ),
                    ),
                  )
                : null,
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (article.category.isNotEmpty)
                    VibeTag(label: article.categoryLabel),
                  const SizedBox(height: 10),
                  Text(
                    article.title,
                    style: VibeMatchTextStyles.cardTitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (article.excerpt.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      article.excerpt,
                      style: VibeMatchTextStyles.body,
                      maxLines: excerptLines,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const Spacer(),
                  Text(
                    '${article.readMinutes} min de leitura',
                    style: VibeMatchTextStyles.caption.copyWith(
                      color: VibeMatchColors.scoreGold,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
