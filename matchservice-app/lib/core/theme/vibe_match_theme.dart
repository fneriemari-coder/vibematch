import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// "VIBE MATCH" design system — Cyber-Premium palette + shared style tokens.
/// Import `VibeMatchColors`/`VibeMatchRadii`/`vibeMatchTheme` anywhere in the
/// app instead of hardcoding colors so a future rebrand only touches this file.
class VibeMatchColors {
  VibeMatchColors._();

  static const Color background = Color(0xFF1E112C); // Liquid Amethyst
  static const Color surface = Color(
    0xFF2A1B3D,
  ); // Dark Glass (use withOpacity(0.8) on cards)
  static const Color neonPrimary = Color(0xFF00F0FF); // Neon Cyan accent
  static const Color scoreGold = Color(
    0xFFFFB800,
  ); // Sculpted Gold — ratings/K-Score
  static const Color textHigh = Color(0xFFF3F4F6); // Silver White
  static const Color textLow = Color(0xFF9CA3AF); // Low-contrast secondary text

  static const List<Color> ctaGradient = [
    background,
    neonPrimary,
  ]; // Amethyst -> Cyan
}

class VibeMatchRadii {
  VibeMatchRadii._();

  static const double card = 16;
  static const double button = 12;
  static BorderRadius get cardRadius => BorderRadius.circular(card);
  static BorderRadius get buttonRadius => BorderRadius.circular(button);
}

class VibeMatchTextStyles {
  VibeMatchTextStyles._();

  static TextStyle get heading => GoogleFonts.inter(
    fontSize: 22,
    fontWeight: FontWeight.bold,
    color: VibeMatchColors.textHigh,
    letterSpacing: -0.2,
  );

  static TextStyle get subheading => GoogleFonts.inter(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    color: VibeMatchColors.textHigh,
  );

  static TextStyle get body => GoogleFonts.inter(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: VibeMatchColors.textLow,
  );

  static TextStyle get scoreDigits => GoogleFonts.inter(
    fontSize: 16,
    fontWeight: FontWeight.w800,
    color: VibeMatchColors.scoreGold,
    letterSpacing: 1.2,
  );
}

ThemeData buildVibeMatchTheme() {
  final base = ThemeData.dark();
  return base.copyWith(
    scaffoldBackgroundColor: VibeMatchColors.background,
    primaryColor: VibeMatchColors.neonPrimary,
    colorScheme: base.colorScheme.copyWith(
      primary: VibeMatchColors.neonPrimary,
      secondary: VibeMatchColors.scoreGold,
      surface: VibeMatchColors.surface,
      onPrimary: VibeMatchColors.background,
      onSurface: VibeMatchColors.textHigh,
    ),
    textTheme: GoogleFonts.interTextTheme(base.textTheme).apply(
      bodyColor: VibeMatchColors.textHigh,
      displayColor: VibeMatchColors.textHigh,
    ),
    // Circular match/swipe action buttons — subtle elevation + tactile feedback.
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: VibeMatchColors.surface,
      foregroundColor: VibeMatchColors.neonPrimary,
      elevation: 6,
      highlightElevation: 10,
      shape: const CircleBorder(),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: VibeMatchColors.surface,
        foregroundColor: VibeMatchColors.textHigh,
        shape: RoundedRectangleBorder(
          borderRadius: VibeMatchRadii.buttonRadius,
        ),
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
      ),
    ),
    cardColor: VibeMatchColors.surface,
  );
}
