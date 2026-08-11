import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// "VIBE MATCH" design system.
///
/// The palette is deep navy + gold: the visual language of business education,
/// not of a consumer dating app. The previous amethyst/neon-cyan scheme read as
/// nightlife and undercut the fact that people come here to close contracts.
///
/// Token names are deliberately unchanged from that first palette
/// (`background`, `surface`, `neonPrimary`, `scoreGold`) even though the values
/// are entirely new, so every screen already written against them picks up the
/// rebrand without edits. `neonPrimary` is now the gold accent — it is the
/// single "act on this" colour across the app.
class VibeMatchColors {
  VibeMatchColors._();

  // --- Core surfaces, darkest to lightest ---------------------------------
  /// Near-black. Reserved for full-bleed cinematic sections and the nav bar,
  /// where the surrounding chrome should disappear into the image.
  static const Color ink = Color(0xFF050A0F);
  static const Color background = Color(0xFF0B2237); // App background
  static const Color surface = Color(0xFF12314C); // Cards, sheets, inputs
  static const Color slate =
      Color(0xFF1D4763); // Section bands, dividers-on-dark
  static const Color cream = Color(0xFFF5F2EA); // Inverted "editorial" sections

  // --- Accent -------------------------------------------------------------
  static const Color neonPrimary = Color(0xFFC9A46B); // Gold — primary CTA
  static const Color scoreGold =
      Color(0xFFE3C48D); // Lighter gold — ratings/K-Score
  static const Color goldDeep = Color(0xFF8A6B38); // Gold pressed/border state

  // --- Text ---------------------------------------------------------------
  static const Color textHigh = Color(0xFFF4F1EC);
  static const Color textLow = Color(0xFF9DB0C0);
  static const Color textOnCream = Color(0xFF0B2237);
  static const Color textOnCreamLow = Color(0xFF5A6B78);

  // --- Status -------------------------------------------------------------
  static const Color positive = Color(0xFF4FB286);
  static const Color negative = Color(0xFFD9604F);
  static const Color live = Color(0xFFE05B4A); // "AO VIVO" badge

  /// Hairline border for cards on dark backgrounds.
  static const Color border = Color(0x1FFFFFFF);

  static const List<Color> ctaGradient = [neonPrimary, scoreGold];

  /// Vertical wash used behind hero sections — near-black at the top so the
  /// navigation bar reads as part of the image, opening up to navy underneath.
  static const List<Color> heroGradient = [ink, background, slate];

  /// Deterministic cover gradient for content that has no image yet. Keyed off
  /// a stable string (article slug, course id) so the same card always gets the
  /// same colours across rebuilds instead of flickering between frames.
  static List<Color> coverGradientFor(String seed) {
    const palettes = <List<Color>>[
      [Color(0xFF12314C), Color(0xFF1D4763)],
      [Color(0xFF1B3A2E), Color(0xFF2E5D48)],
      [Color(0xFF3A2418), Color(0xFF6B462A)],
      [Color(0xFF241C3A), Color(0xFF473A6B)],
      [Color(0xFF3A1C24), Color(0xFF6B3341)],
      [Color(0xFF12384C), Color(0xFF1D6370)],
    ];
    var hash = 0;
    for (final unit in seed.codeUnits) {
      hash = (hash * 31 + unit) & 0x7FFFFFFF;
    }
    return palettes[hash % palettes.length];
  }
}

class VibeMatchRadii {
  VibeMatchRadii._();

  static const double card = 14;
  static const double button = 8;
  static const double pill = 999;

  static BorderRadius get cardRadius => BorderRadius.circular(card);
  static BorderRadius get buttonRadius => BorderRadius.circular(button);
  static BorderRadius get pillRadius => BorderRadius.circular(pill);
}

/// Horizontal rhythm. Content sits on one gutter everywhere so the eye tracks a
/// single left edge down a long, information-dense page.
class VibeMatchSpacing {
  VibeMatchSpacing._();

  static const double gutter = 20;
  static const double sectionGap = 44;
  static const double maxContentWidth = 1180;
}

class VibeMatchTextStyles {
  VibeMatchTextStyles._();

  // --- Display (serif) ----------------------------------------------------
  // Playfair Display carries the authority the brand is reaching for; the
  // italic cut in gold is reserved for the emphasised phrase in a headline.

  /// Hero headline. Size is passed by the caller because it scales hard between
  /// phone and desktop — see `HeroHeadline`.
  static TextStyle display(double size) => GoogleFonts.playfairDisplay(
        fontSize: size,
        height: 1.08,
        fontWeight: FontWeight.w500,
        color: VibeMatchColors.textHigh,
        letterSpacing: -0.5,
      );

  /// The emphasised half of a headline — italic, gold.
  static TextStyle displayAccent(double size) => GoogleFonts.playfairDisplay(
        fontSize: size,
        height: 1.08,
        fontWeight: FontWeight.w500,
        fontStyle: FontStyle.italic,
        color: VibeMatchColors.neonPrimary,
        letterSpacing: -0.5,
      );

  static TextStyle get sectionTitle => GoogleFonts.playfairDisplay(
        fontSize: 27,
        height: 1.15,
        fontWeight: FontWeight.w500,
        color: VibeMatchColors.textHigh,
      );

  static TextStyle get sectionTitleAccent => GoogleFonts.playfairDisplay(
        fontSize: 27,
        height: 1.15,
        fontWeight: FontWeight.w500,
        fontStyle: FontStyle.italic,
        color: VibeMatchColors.neonPrimary,
      );

  /// Big numbers — the "1.094.176 empregos" move. Tabular so digits don't jitter.
  static TextStyle stat(double size) => GoogleFonts.playfairDisplay(
        fontSize: size,
        height: 1,
        fontWeight: FontWeight.w500,
        color: VibeMatchColors.neonPrimary,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  // --- UI (sans) ----------------------------------------------------------

  /// Small uppercase label above a section title.
  static TextStyle get eyebrow => GoogleFonts.inter(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: VibeMatchColors.neonPrimary,
        letterSpacing: 1.8,
      );

  static TextStyle get heading => GoogleFonts.inter(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: VibeMatchColors.textHigh,
        letterSpacing: -0.2,
      );

  static TextStyle get cardTitle => GoogleFonts.inter(
        fontSize: 16,
        height: 1.3,
        fontWeight: FontWeight.w600,
        color: VibeMatchColors.textHigh,
        letterSpacing: -0.1,
      );

  static TextStyle get subheading => GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: VibeMatchColors.textHigh,
      );

  static TextStyle get body => GoogleFonts.inter(
        fontSize: 14,
        height: 1.5,
        fontWeight: FontWeight.w400,
        color: VibeMatchColors.textLow,
      );

  static TextStyle get caption => GoogleFonts.inter(
        fontSize: 12,
        height: 1.4,
        fontWeight: FontWeight.w500,
        color: VibeMatchColors.textLow,
      );

  /// Long-form article body — larger and looser than UI text, because it is
  /// read in paragraphs rather than scanned.
  static TextStyle get readingBody => GoogleFonts.inter(
        fontSize: 16,
        height: 1.72,
        fontWeight: FontWeight.w400,
        color: VibeMatchColors.textHigh.withOpacity(0.86),
      );

  static TextStyle get scoreDigits => GoogleFonts.inter(
        fontSize: 16,
        fontWeight: FontWeight.w800,
        color: VibeMatchColors.scoreGold,
        letterSpacing: 1.2,
      );

  static TextStyle get button => GoogleFonts.inter(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.2,
      );
}

ThemeData buildVibeMatchTheme() {
  final base = ThemeData.dark();
  return base.copyWith(
    scaffoldBackgroundColor: VibeMatchColors.background,
    primaryColor: VibeMatchColors.neonPrimary,
    dividerColor: VibeMatchColors.border,
    colorScheme: base.colorScheme.copyWith(
      primary: VibeMatchColors.neonPrimary,
      secondary: VibeMatchColors.scoreGold,
      surface: VibeMatchColors.surface,
      onPrimary: VibeMatchColors.ink,
      onSurface: VibeMatchColors.textHigh,
      error: VibeMatchColors.negative,
    ),
    textTheme: GoogleFonts.interTextTheme(base.textTheme).apply(
      bodyColor: VibeMatchColors.textHigh,
      displayColor: VibeMatchColors.textHigh,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: VibeMatchColors.background,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: VibeMatchTextStyles.subheading.copyWith(fontSize: 17),
      iconTheme: const IconThemeData(color: VibeMatchColors.textHigh),
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: VibeMatchColors.surface,
      foregroundColor: VibeMatchColors.neonPrimary,
      elevation: 6,
      highlightElevation: 10,
      shape: CircleBorder(),
    ),
    // Gold fill, ink text — the reference's single unmistakable "do this" button.
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: VibeMatchColors.neonPrimary,
        foregroundColor: VibeMatchColors.ink,
        disabledBackgroundColor: VibeMatchColors.slate,
        disabledForegroundColor: VibeMatchColors.textLow,
        elevation: 0,
        textStyle: VibeMatchTextStyles.button,
        shape:
            RoundedRectangleBorder(borderRadius: VibeMatchRadii.buttonRadius),
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 26),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: VibeMatchColors.textHigh,
        textStyle: VibeMatchTextStyles.button,
        side: const BorderSide(color: VibeMatchColors.neonPrimary),
        shape:
            RoundedRectangleBorder(borderRadius: VibeMatchRadii.buttonRadius),
        padding: const EdgeInsets.symmetric(vertical: 15, horizontal: 24),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: VibeMatchColors.neonPrimary,
        textStyle: VibeMatchTextStyles.button,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: VibeMatchColors.surface,
      labelStyle: VibeMatchTextStyles.body,
      hintStyle: VibeMatchTextStyles.body,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: VibeMatchRadii.buttonRadius,
        borderSide: const BorderSide(color: VibeMatchColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: VibeMatchRadii.buttonRadius,
        borderSide: const BorderSide(color: VibeMatchColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: VibeMatchRadii.buttonRadius,
        borderSide: const BorderSide(color: VibeMatchColors.neonPrimary),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: VibeMatchColors.surface,
      side: const BorderSide(color: VibeMatchColors.border),
      labelStyle: VibeMatchTextStyles.caption,
      shape: RoundedRectangleBorder(borderRadius: VibeMatchRadii.pillRadius),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: VibeMatchColors.ink,
      selectedItemColor: VibeMatchColors.neonPrimary,
      unselectedItemColor: VibeMatchColors.textLow,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
    ),
    cardColor: VibeMatchColors.surface,
  );
}
