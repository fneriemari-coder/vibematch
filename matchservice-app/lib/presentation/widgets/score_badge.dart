import 'package:flutter/material.dart';
import '../../core/theme/vibe_match_theme.dart';

/// "K-SCORE" — renders ProviderScore.financialHealthScore (0-1000) as a
/// futuristic digital-display readout: black glossy housing, gold digits.
class ScoreBadge extends StatelessWidget {
  const ScoreBadge({super.key, required this.score, this.compact = false});

  /// 0-1000, mirrors the backend's ScoreEngine output.
  final int score;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 8 : 12, vertical: compact ? 4 : 6),
      decoration: BoxDecoration(
        color: Colors.black,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.black87, width: 2),
        boxShadow: [
          BoxShadow(
            color: VibeMatchColors.scoreGold.withOpacity(0.35),
            blurRadius: 8,
            spreadRadius: 0.5,
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.bolt, size: compact ? 12 : 14, color: VibeMatchColors.scoreGold),
          const SizedBox(width: 4),
          Text(
            score.toString().padLeft(4, '0'),
            style: VibeMatchTextStyles.scoreDigits.copyWith(
              fontSize: compact ? 12 : 16,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}
