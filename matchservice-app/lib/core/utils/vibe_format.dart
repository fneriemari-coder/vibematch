// Display formatting shared by the redesigned feature screens.
//
// Deliberately free of locale data: `intl`'s DateFormat with a `pt_BR` locale
// needs initializeDateFormatting() to have run first, and the app never calls
// it — a localised pattern would silently fall back to US ordering. The handful
// of Brazilian formats these screens actually show are cheaper to write out
// than to risk getting wrong at runtime.

const List<String> _monthsLong = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const List<String> _monthsShort = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/// 1234567 -> "1.234.567". Used for the oversized student/view counts, where
/// an ungrouped seven-digit run is unreadable at display size.
String formatCount(int value) {
  final digits = value.abs().toString();
  final buffer = StringBuffer(value < 0 ? '-' : '');
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return buffer.toString();
}

/// Prisma `Decimal` columns reach the client as either a JSON number or a
/// string depending on the serializer, so every money field is carried as a
/// string and parsed here — the same defence as `RecommendedProvider.hourlyRate`.
///
/// Returns null when there is nothing to show so callers can choose their own
/// copy ("Gratuito", "Sob consulta") rather than printing a misleading "R$ 0".
String? formatMoney(String? amount, String currency) {
  if (amount == null) return null;
  final trimmed = amount.trim();
  if (trimmed.isEmpty) return null;

  final symbol = currency == 'BRL' ? r'R$' : r'$';
  final value = double.tryParse(trimmed);
  // An unparseable value still gets shown verbatim: whatever the backend sent
  // is more informative to the user than swallowing the field.
  if (value == null) return '$symbol $trimmed';

  final cents = (value * 100).round();
  final whole = cents ~/ 100;
  final fraction = (cents % 100).abs();
  final head = formatCount(whole);
  if (fraction == 0) return '$symbol $head';
  return '$symbol $head,${fraction.toString().padLeft(2, '0')}';
}

/// "11 de agosto de 2026" — the dateline under an article title.
String formatFullDate(DateTime date) {
  final local = date.toLocal();
  return '${local.day} de ${_monthsLong[local.month - 1]} de ${local.year}';
}

/// "11 de ago • 19h30" — dense enough for a live-session row.
String formatShortDateTime(DateTime date) {
  final local = date.toLocal();
  final minute = local.minute.toString().padLeft(2, '0');
  return '${local.day} de ${_monthsShort[local.month - 1]} • '
      '${local.hour}h$minute';
}

/// Drops the decimal point on whole numbers so a K-Score of 780 renders as
/// "780" rather than "780.0".
String formatScore(double value) => value == value.roundToDouble()
    ? value.toStringAsFixed(0)
    : value.toStringAsFixed(1);
