import 'package:flutter/material.dart';
import '../theme/vibe_match_theme.dart';

/// Elegant warning modal shown when POST /feed/post comes back 422 —
/// the post was blocked by ai-moderator.service.ts (safety or off-scope).
Future<void> showModerationBlockedModal(BuildContext context, {String? reason}) {
  return showDialog(
    context: context,
    builder: (context) => Dialog(
      backgroundColor: VibeMatchColors.surface,
      shape: RoundedRectangleBorder(borderRadius: VibeMatchRadii.cardRadius),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.redAccent.withOpacity(0.15),
              ),
              child: const Icon(Icons.shield_moon_outlined, color: Colors.redAccent, size: 28),
            ),
            const SizedBox(height: 16),
            Text('Conteúdo bloqueado', style: VibeMatchTextStyles.heading.copyWith(fontSize: 18)),
            const SizedBox(height: 10),
            const Text(
              'Conteúdo fora de diretrizes. O VIBE MATCH mantém o feed focado estritamente em '
              'soluções e serviços profissionais. Revise sua publicação.',
              textAlign: TextAlign.center,
              style: TextStyle(color: VibeMatchColors.textLow, height: 1.4),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: VibeMatchColors.neonPrimary,
                  foregroundColor: Colors.black,
                ),
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Entendi'),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
