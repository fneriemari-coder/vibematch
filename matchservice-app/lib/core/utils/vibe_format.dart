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

/// "agora há pouco" / "há 3 h" / "ontem" / "11 de ago" — for lists where the
/// interesting fact is recency, not the calendar date. Falls back to the short
/// date beyond a week, and includes the year once the date is far enough away
/// that "11 de ago" would be ambiguous.
String formatRelativeDate(DateTime date) {
  final local = date.toLocal();
  final delta = DateTime.now().difference(local);

  if (delta.isNegative) return 'agora há pouco';
  if (delta.inMinutes < 1) return 'agora há pouco';
  if (delta.inMinutes < 60) return 'há ${delta.inMinutes} min';
  if (delta.inHours < 24) return 'há ${delta.inHours} h';
  if (delta.inDays == 1) return 'ontem';
  if (delta.inDays < 7) return 'há ${delta.inDays} dias';

  final short = '${local.day} de ${_monthsShort[local.month - 1]}';
  return delta.inDays < 330 ? short : '$short de ${local.year}';
}

/// "8,4 KB" / "1,2 MB" — file sizes in the Brazilian decimal convention.
/// Bytes stay whole; anything larger gets one decimal place, because "1 MB"
/// and "1,9 MB" are meaningfully different when there is a 10MB ceiling.
String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  const units = ['KB', 'MB', 'GB'];
  var value = bytes / 1024;
  var unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  final rounded = (value * 10).round() / 10;
  final text = rounded == rounded.roundToDouble()
      ? rounded.toStringAsFixed(0)
      : rounded.toStringAsFixed(1).replaceAll('.', ',');
  return '$text ${units[unit]}';
}

/// Drops the decimal point on whole numbers so a K-Score of 780 renders as
/// "780" rather than "780.0".
String formatScore(double value) => value == value.roundToDouble()
    ? value.toStringAsFixed(0)
    : value.toStringAsFixed(1);
