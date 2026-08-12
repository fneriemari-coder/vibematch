/// Models for POST /diagnostics, GET /diagnostics and GET /diagnostics/:id.
///
/// The diagnostic is the product's differentiating moment: a manager describes,
/// in their own words, what is going wrong in the business, and gets back a
/// four-pillar reading of where the bottleneck actually is, plus the brief for
/// who to hire to fix it.

/// The bounds the API enforces on `situation`. Kept here rather than in the
/// screen so the composer, the repository and the error copy all cite the same
/// numbers.
const int kDiagnosticMinChars = 40;
const int kDiagnosticMaxChars = 4000;

/// Wire values of `weakestPillar`, in the order they are drawn on the radar —
/// clockwise from the top. The API stores unaccented screaming snake case.
const List<String> diagnosticPillarKeys = <String>[
  'VENDAS',
  'GESTAO',
  'TECNOLOGIA',
  'FINANCAS',
];

const Map<String, String> diagnosticPillarLabels = <String, String>{
  'VENDAS': 'Vendas',
  'GESTAO': 'Gestão',
  'TECNOLOGIA': 'Tecnologia',
  'FINANCAS': 'Finanças',
};

/// Falls back to the raw wire value so a pillar renamed on the backend before
/// this map catches up still reads as something rather than as a blank.
String diagnosticPillarLabel(String pillar) =>
    diagnosticPillarLabels[pillar.toUpperCase()] ?? pillar;

/// One short sentence per pillar, used under the radar so the four axes mean
/// something to someone seeing them for the first time.
const Map<String, String> diagnosticPillarDescriptions = <String, String>{
  'VENDAS': 'Como entram clientes: prospecção, proposta e fechamento.',
  'GESTAO': 'Como o trabalho anda: processo, time e acompanhamento.',
  'TECNOLOGIA': 'O que sustenta a operação: sistemas, dados e automação.',
  'FINANCAS': 'O que sobra no fim: preço, margem, caixa e cobrança.',
};

/// The four scores, 0–100.
///
/// Every field is parsed through `double.tryParse` on the stringified value:
/// the backend may send an int, a double or a Prisma `Decimal` string, and a
/// blind cast to `double` blows up on the first two.
class DiagnosticPillars {
  const DiagnosticPillars({
    required this.vendas,
    required this.gestao,
    required this.tecnologia,
    required this.financas,
  });

  final double vendas;
  final double gestao;
  final double tecnologia;
  final double financas;

  /// In the same order as [diagnosticPillarKeys], so the radar can walk the two
  /// lists together.
  List<double> get asList => [vendas, gestao, tecnologia, financas];

  double scoreFor(String pillar) {
    switch (pillar.toUpperCase()) {
      case 'VENDAS':
        return vendas;
      case 'GESTAO':
        return gestao;
      case 'TECNOLOGIA':
        return tecnologia;
      case 'FINANCAS':
        return financas;
      default:
        return 0;
    }
  }

  /// Used as the fallback when `weakestPillar` is missing or unrecognised —
  /// the finding is derivable from the scores, so it never has to be omitted.
  String get lowestKey {
    var key = diagnosticPillarKeys.first;
    var lowest = scoreFor(key);
    for (final candidate in diagnosticPillarKeys.skip(1)) {
      final value = scoreFor(candidate);
      if (value < lowest) {
        lowest = value;
        key = candidate;
      }
    }
    return key;
  }

  double get average =>
      (vendas + gestao + tecnologia + financas) / diagnosticPillarKeys.length;

  static double _score(Object? raw) {
    final value = double.tryParse('${raw ?? 0}') ?? 0;
    // The contract says 0..100; clamping here means one out-of-range score
    // cannot push a radar vertex outside the chart.
    return value.clamp(0, 100).toDouble();
  }

  factory DiagnosticPillars.fromJson(Map<String, dynamic> json) =>
      DiagnosticPillars(
        vendas: _score(json['vendas']),
        gestao: _score(json['gestao']),
        tecnologia: _score(json['tecnologia']),
        financas: _score(json['financas']),
      );
}

class Diagnostic {
  const Diagnostic({
    required this.id,
    required this.situation,
    required this.pillars,
    required this.weakestPillar,
    required this.summary,
    required this.recommendations,
    required this.suggestedSkills,
    required this.aiGenerated,
    required this.createdAt,
  });

  final String id;
  final String situation;
  final DiagnosticPillars pillars;

  /// One of [diagnosticPillarKeys]. Normalised on parse and backfilled from
  /// the scores when the server omits it.
  final String weakestPillar;
  final String summary;
  final List<String> recommendations;

  /// What to look for when hiring — this is what turns a diagnostic into a
  /// brief rather than a report.
  final List<String> suggestedSkills;

  /// False when the backend fell back to its own scoring because the model was
  /// unavailable. Surfaced in the UI: the reader always knows which produced
  /// the reading in front of them.
  final bool aiGenerated;

  /// Null only if the server omits it — the history list then shows the entry
  /// without a dateline rather than an epoch date.
  final DateTime? createdAt;

  String get weakestPillarLabel => diagnosticPillarLabel(weakestPillar);

  double get weakestScore => pillars.scoreFor(weakestPillar);

  factory Diagnostic.fromJson(Map<String, dynamic> json) {
    final pillars = DiagnosticPillars.fromJson(
      (json['pillars'] as Map?)?.cast<String, dynamic>() ??
          const <String, dynamic>{},
    );
    final rawWeakest = (json['weakestPillar'] as String? ?? '').toUpperCase();
    return Diagnostic(
      id: json['id'] as String? ?? '',
      situation: json['situation'] as String? ?? '',
      pillars: pillars,
      weakestPillar: diagnosticPillarKeys.contains(rawWeakest)
          ? rawWeakest
          : pillars.lowestKey,
      summary: json['summary'] as String? ?? '',
      recommendations: _stringList(json['recommendations']),
      suggestedSkills: _stringList(json['suggestedSkills']),
      aiGenerated: json['aiGenerated'] as bool? ?? false,
      createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
    );
  }

  /// Tolerates nulls and non-string entries, and drops blanks — an empty
  /// bullet renders as a numbered line with nothing after it, which reads as a
  /// bug rather than as a missing recommendation.
  static List<String> _stringList(Object? raw) {
    if (raw is! List) return const [];
    return raw
        .map((e) => '${e ?? ''}'.trim())
        .where((e) => e.isNotEmpty)
        .toList(growable: false);
  }
}
