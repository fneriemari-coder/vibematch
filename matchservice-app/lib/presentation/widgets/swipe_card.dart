import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/user_models.dart';
import 'vibe_ui.dart';

/// Swipe-deck card.
///
/// The first version pulled a "portfolio image" from `source.unsplash.com`
/// keyed off the candidate's first skill. That service was retired, so every
/// request failed and every card fell through to a bare grey rectangle — which
/// is why the deck looked empty. There is no portfolio image on
/// `SwipeCandidate` at all, so instead of inventing one this card is built
/// entirely from the profile data the API actually returns: K-Score, rating,
/// rate, skills, bio, distance.
class SwipeCard extends StatelessWidget {
  const SwipeCard({super.key, required this.candidate, this.dragging = false});

  final SwipeCandidate candidate;

  /// Lights the border gold while the card is being dragged.
  final bool dragging;

  @override
  Widget build(BuildContext context) {
    final kScore = candidate.financialHealthScore;

    return VibeCard(
      highlighted: dragging,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          VibeCover(
            seed: candidate.userId,
            height: 132,
            icon: Icons.workspace_premium_rounded,
            overlay: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _Monogram(name: candidate.name),
                      const Spacer(),
                      if (candidate.isProBoosted == true) ...[
                        const VibeTag(
                          label: 'Pro',
                          icon: Icons.verified_rounded,
                          filled: true,
                        ),
                        const SizedBox(width: 6),
                      ],
                      if (kScore != null) _KScoreChip(score: kScore),
                    ],
                  ),
                  const Spacer(),
                  Text(
                    candidate.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: VibeMatchTextStyles.display(23),
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (candidate.averageRating > 0)
                        VibeRating(rating: candidate.averageRating),
                      if (candidate.averageRating > 0 &&
                          candidate.distanceMeters != null)
                        const _Dot(),
                      if (candidate.distanceMeters != null)
                        Text(
                          _formatDistance(candidate.distanceMeters!),
                          style: VibeMatchTextStyles.caption,
                        ),
                    ],
                  ),
                  if (candidate.bio.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Expanded(
                      child: Text(
                        candidate.bio,
                        overflow: TextOverflow.fade,
                        style: VibeMatchTextStyles.body,
                      ),
                    ),
                  ] else
                    const Spacer(),
                  if (candidate.skills.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: candidate.skills
                          .take(4)
                          .map((s) => VibeTag(label: s))
                          .toList(),
                    ),
                  ],
                  if (candidate.hourlyRate != null) ...[
                    const SizedBox(height: 14),
                    const Divider(height: 1, color: VibeMatchColors.border),
                    const SizedBox(height: 12),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Text(
                          _formatRate(
                            candidate.hourlyRate!,
                            candidate.rateCurrency,
                          ),
                          style: VibeMatchTextStyles.stat(22),
                        ),
                        const SizedBox(width: 5),
                        Text('/ hora', style: VibeMatchTextStyles.caption),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _formatDistance(double metres) => metres < 1000
      ? '${metres.round()} m de você'
      : '${(metres / 1000).toStringAsFixed(1)} km de você';

  static String _formatRate(String rate, String currency) {
    final symbol = currency == 'BRL' ? 'R\$' : 'US\$';
    final value = double.tryParse(rate);
    final shown = value == null
        ? rate
        : value.toStringAsFixed(value.truncateToDouble() == value ? 0 : 2);
    return '$symbol $shown';
  }
}

/// Initials in a gold-bordered square. Stands in for the avatar the API does
/// not return yet, and still identifies the person at a glance.
class _Monogram extends StatelessWidget {
  const _Monogram({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    final initials = parts.isEmpty
        ? '?'
        : parts.length == 1
            ? parts.first.characters.first.toUpperCase()
            : '${parts.first.characters.first}${parts.last.characters.first}'
                .toUpperCase();

    return Container(
      height: 42,
      width: 42,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: VibeMatchColors.ink.withOpacity(0.55),
        borderRadius: VibeMatchRadii.buttonRadius,
        border:
            Border.all(color: VibeMatchColors.neonPrimary.withOpacity(0.55)),
      ),
      child: Text(
        initials,
        style: VibeMatchTextStyles.subheading.copyWith(
          color: VibeMatchColors.scoreGold,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

/// K-Score, labelled. An unlabelled number on a card means nothing to someone
/// seeing the deck for the first time.
class _KScoreChip extends StatelessWidget {
  const _KScoreChip({required this.score});

  final int score;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: VibeMatchColors.ink.withOpacity(0.62),
        borderRadius: VibeMatchRadii.buttonRadius,
        border: Border.all(color: VibeMatchColors.scoreGold.withOpacity(0.5)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'K-SCORE',
            style: VibeMatchTextStyles.eyebrow.copyWith(
              fontSize: 8,
              color: VibeMatchColors.textLow,
            ),
          ),
          Text('$score', style: VibeMatchTextStyles.scoreDigits),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 7),
        child: Text('·', style: VibeMatchTextStyles.caption),
      );
}
