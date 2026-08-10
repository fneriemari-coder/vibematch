import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/user_models.dart';
import 'score_badge.dart';
import 'vibe_glass_card.dart';

/// Swipe-deck card: portfolio image, skill badges, K-Score, price/budget.
/// `dragging` lights up the neon border per the VIBE MATCH micro-interaction spec.
class SwipeCard extends StatelessWidget {
  const SwipeCard({super.key, required this.candidate, this.dragging = false});

  final SwipeCandidate candidate;
  final bool dragging;

  @override
  Widget build(BuildContext context) {
    final portfolioUrl = candidate.skills.isNotEmpty
        ? 'https://source.unsplash.com/600x800/?${Uri.encodeComponent(candidate.skills.first)}'
        : null;

    return VibeGlassCard(
      highlighted: dragging,
      padding: EdgeInsets.zero,
      child: ClipRRect(
        borderRadius: VibeMatchRadii.cardRadius,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (portfolioUrl != null)
              CachedNetworkImage(
                imageUrl: portfolioUrl,
                fit: BoxFit.cover,
                errorWidget: (_, __, ___) =>
                    const ColoredBox(color: VibeMatchColors.surface),
              )
            else
              const ColoredBox(color: VibeMatchColors.surface),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Colors.transparent, Colors.black87],
                  stops: [0.5, 1.0],
                ),
              ),
            ),
            Positioned(
              top: 16,
              right: 16,
              child: ScoreBadge(score: candidate.financialHealthScore ?? 500),
            ),
            if (candidate.isProBoosted == true)
              const Positioned(
                top: 16,
                left: 16,
                child: Icon(
                  Icons.verified,
                  color: VibeMatchColors.neonPrimary,
                  size: 22,
                ),
              ),
            Positioned(
              left: 16,
              right: 16,
              bottom: 20,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(candidate.name, style: VibeMatchTextStyles.heading),
                  const SizedBox(height: 4),
                  Text(
                    candidate.bio,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: VibeMatchTextStyles.body,
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: candidate.skills
                        .take(4)
                        .map(
                          (s) => Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: VibeMatchColors.neonPrimary.withOpacity(
                                0.15,
                              ),
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(
                                color: VibeMatchColors.neonPrimary.withOpacity(
                                  0.4,
                                ),
                              ),
                            ),
                            child: Text(
                              s,
                              style: const TextStyle(
                                color: VibeMatchColors.neonPrimary,
                                fontSize: 11,
                              ),
                            ),
                          ),
                        )
                        .toList(),
                  ),
                  if (candidate.hourlyRate != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      '${candidate.hourlyRate}/${candidate.rateCurrency} · hora',
                      style: VibeMatchTextStyles.subheading.copyWith(
                        color: VibeMatchColors.scoreGold,
                      ),
                    ),
                  ],
                  if (candidate.distanceMeters != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      '${(candidate.distanceMeters! / 1000).toStringAsFixed(1)} km de você',
                      style: VibeMatchTextStyles.body,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
