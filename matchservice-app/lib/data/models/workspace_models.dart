/// Models for the Copiloto workspace — POST /workspace/documents,
/// POST /workspace/documents/:id/analyses, GET /workspace/documents,
/// GET /workspace/documents/:id and DELETE /workspace/documents/:id.
///
/// The workspace is where a document the user already has (a contract, a
/// proposal, a P&L export) is read back to them as a report: what is missing,
/// what it costs, what to do next — and, the part a generic chatbot cannot
/// produce, which providers on the platform can act on it.
///
/// Everything parses defensively. These objects are rendered by a screen that
/// is meant to be the most impressive surface in the app; a single null in a
/// nested list must degrade to an omitted section, never to a red error box.

/// Bounds the API enforces on the analysis `question`. Kept beside the models
/// so the ask box, the disabled-button copy and the repository all cite the
/// same numbers.
const int kWorkspaceQuestionMinChars = 10;
const int kWorkspaceQuestionMaxChars = 600;

/// Upload ceiling from the multipart contract (10MB).
const int kWorkspaceMaxUploadBytes = 10 * 1024 * 1024;

/// Wire values of `kind`, unaccented screaming snake case as the API stores
/// them.
const List<String> workspaceDocumentKinds = <String>[
  'CONTRATO',
  'PROPOSTA',
  'FINANCEIRO',
  'PLANILHA',
  'RELATORIO',
  'OUTRO',
];

const Map<String, String> workspaceDocumentKindLabels = <String, String>{
  'CONTRATO': 'Contrato',
  'PROPOSTA': 'Proposta',
  'FINANCEIRO': 'Financeiro',
  'PLANILHA': 'Planilha',
  'RELATORIO': 'Relatório',
  'OUTRO': 'Outro',
};

/// Falls back to the raw wire value so a kind added on the backend before this
/// map catches up still reads as something rather than as a blank tag.
String workspaceDocumentKindLabel(String kind) =>
    workspaceDocumentKindLabels[kind.toUpperCase()] ?? kind;

/// Wire values of `AnalysisFinding.severity`, most severe first.
const List<String> workspaceSeverities = <String>['ALTA', 'MEDIA', 'BAIXA'];

const Map<String, String> workspaceSeverityLabels = <String, String>{
  'ALTA': 'Alta',
  'MEDIA': 'Média',
  'BAIXA': 'Baixa',
};

String workspaceSeverityLabel(String severity) =>
    workspaceSeverityLabels[severity.toUpperCase()] ?? severity;

/// Wire values of `Analysis.status`.
const String kAnalysisPending = 'PENDING';
const String kAnalysisReady = 'READY';
const String kAnalysisFailed = 'FAILED';

/// The MIME types the upload endpoint accepts. Text is the only one the app
/// can produce from a paste, but the list is the contract and is quoted in the
/// UI so the user knows what a future file picker will be allowed to send.
const List<String> kWorkspaceAcceptedMimeTypes = <String>[
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/pdf',
];

/// A document the user put into the workspace.
class WorkspaceDocument {
  const WorkspaceDocument({
    required this.id,
    required this.filename,
    required this.mimeType,
    required this.sizeBytes,
    required this.kind,
    required this.charCount,
    required this.createdAt,
    this.analyses = const [],
  });

  final String id;
  final String filename;
  final String mimeType;
  final int sizeBytes;

  /// One of [workspaceDocumentKinds] — the backend's classification of what
  /// the document is, which is what lets the list be scanned by type.
  final String kind;
  final int charCount;

  /// Null only when the server omits it; the list then shows the row without a
  /// dateline rather than an epoch date.
  final DateTime? createdAt;

  /// Populated by GET /workspace/documents/:id. The list endpoint does not
  /// return them, so this is empty there rather than null.
  final List<WorkspaceAnalysis> analyses;

  String get kindLabel => workspaceDocumentKindLabel(kind);

  /// Newest analysis first — the detail view leads with the most recent answer
  /// and lists the rest as history.
  List<WorkspaceAnalysis> get analysesNewestFirst {
    final sorted = [...analyses];
    sorted.sort((a, b) {
      final left = a.createdAt;
      final right = b.createdAt;
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return right.compareTo(left);
    });
    return sorted;
  }

  WorkspaceDocument copyWith({List<WorkspaceAnalysis>? analyses}) =>
      WorkspaceDocument(
        id: id,
        filename: filename,
        mimeType: mimeType,
        sizeBytes: sizeBytes,
        kind: kind,
        charCount: charCount,
        createdAt: createdAt,
        analyses: analyses ?? this.analyses,
      );

  factory WorkspaceDocument.fromJson(Map<String, dynamic> json) {
    final rawKind = '${json['kind'] ?? ''}'.toUpperCase();
    return WorkspaceDocument(
      id: json['id'] as String? ?? '',
      filename: json['filename'] as String? ?? 'documento',
      mimeType: json['mimeType'] as String? ?? 'text/plain',
      sizeBytes: parseWorkspaceInt(json['sizeBytes']),
      kind: workspaceDocumentKinds.contains(rawKind) ? rawKind : 'OUTRO',
      charCount: parseWorkspaceInt(json['charCount']),
      createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
      analyses: (json['analyses'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => WorkspaceAnalysis.fromJson(e.cast<String, dynamic>()))
          .toList(growable: false),
    );
  }
}

/// One item of the "o que eu encontrei" list — the part that carries the
/// quoted evidence in [detail].
class AnalysisFinding {
  const AnalysisFinding({
    required this.title,
    required this.detail,
    required this.severity,
  });

  final String title;
  final String detail;

  /// One of [workspaceSeverities]. Unrecognised values normalise to `MEDIA` so
  /// the tag always has a colour.
  final String severity;

  String get severityLabel => workspaceSeverityLabel(severity);

  factory AnalysisFinding.fromJson(Map<String, dynamic> json) {
    final rawSeverity = '${json['severity'] ?? ''}'.toUpperCase();
    return AnalysisFinding(
      title: '${json['title'] ?? ''}'.trim(),
      detail: '${json['detail'] ?? ''}'.trim(),
      severity:
          workspaceSeverities.contains(rawSeverity) ? rawSeverity : 'MEDIA',
    );
  }
}

/// A provider on the platform whose skills match what the analysis found.
///
/// This is the differentiator: the answer does not stop at "you should get a
/// lawyer to look at clause 7", it names who, with their K-Score and rate.
class MatchedProvider {
  const MatchedProvider({
    required this.userId,
    required this.name,
    required this.headline,
    required this.skills,
    required this.kScore,
    required this.hourlyRate,
    required this.rateCurrency,
  });

  final String userId;
  final String name;
  final String headline;
  final List<String> skills;

  /// 0–1000, same scale as `ScoreBadge`.
  final int kScore;

  /// Prisma `Decimal` reaches the client as a number or a string depending on
  /// the serializer, so it is carried as a string and formatted by
  /// `formatMoney`.
  final String? hourlyRate;
  final String rateCurrency;

  factory MatchedProvider.fromJson(Map<String, dynamic> json) =>
      MatchedProvider(
        userId: json['userId'] as String? ?? '',
        name: '${json['name'] ?? ''}'.trim(),
        headline: '${json['headline'] ?? ''}'.trim(),
        skills: parseWorkspaceStringList(json['skills']),
        kScore: parseWorkspaceInt(json['kScore']).clamp(0, 1000),
        hourlyRate: json['hourlyRate']?.toString(),
        rateCurrency: json['rateCurrency'] as String? ?? 'BRL',
      );
}

/// What the platform already knows about the person asking. Rendered as a thin
/// strip above the report so the answer visibly comes from somewhere that has
/// their history, not from a blank prompt.
class AnalysisContext {
  const AnalysisContext({
    required this.kScore,
    required this.openContracts,
    required this.weakestPillar,
  });

  final int kScore;
  final int openContracts;

  /// Wire value of the weakest diagnostic pillar, or null when the user has
  /// never run a diagnostic.
  final String? weakestPillar;

  /// True when there is at least one fact worth showing — an all-zero strip
  /// with no pillar is noise and is dropped by the screen.
  bool get hasAnything =>
      kScore > 0 || openContracts > 0 || (weakestPillar?.isNotEmpty ?? false);

  factory AnalysisContext.fromJson(Map<String, dynamic> json) {
    final pillar = '${json['weakestPillar'] ?? ''}'.trim();
    return AnalysisContext(
      kScore: parseWorkspaceInt(json['kScore']),
      openContracts: parseWorkspaceInt(json['openContracts']),
      weakestPillar: pillar.isEmpty || pillar == 'null' ? null : pillar,
    );
  }
}

/// One question asked of one document, and everything the backend wrote back.
class WorkspaceAnalysis {
  const WorkspaceAnalysis({
    required this.id,
    required this.documentId,
    required this.question,
    required this.status,
    required this.headline,
    required this.summary,
    required this.findings,
    required this.risks,
    required this.actions,
    required this.suggestedSkills,
    required this.matchedProviders,
    required this.context,
    required this.aiGenerated,
    required this.createdAt,
  });

  final String id;
  final String documentId;
  final String question;

  /// `PENDING` | `READY` | `FAILED`.
  final String status;
  final String headline;
  final String summary;
  final List<AnalysisFinding> findings;
  final List<String> risks;
  final List<String> actions;
  final List<String> suggestedSkills;
  final List<MatchedProvider> matchedProviders;

  /// Null when the server omits the block entirely.
  final AnalysisContext? context;

  /// False when the backend fell back to its own rules because the model was
  /// unavailable. Always surfaced — a rules-based reading is a different claim
  /// from one the model wrote, and the reader is entitled to know which.
  final bool aiGenerated;
  final DateTime? createdAt;

  bool get isReady => status == kAnalysisReady;
  bool get isPending => status == kAnalysisPending;
  bool get isFailed => status == kAnalysisFailed;

  /// Findings ordered ALTA → MEDIA → BAIXA, so the most severe is read first
  /// regardless of the order the backend happened to emit.
  List<AnalysisFinding> get findingsBySeverity {
    final sorted = [...findings];
    sorted.sort(
      (a, b) => workspaceSeverities
          .indexOf(a.severity)
          .compareTo(workspaceSeverities.indexOf(b.severity)),
    );
    return sorted;
  }

  /// Something to show even when the model returned a thin result — used to
  /// decide between the report layout and the "sem conteúdo" state.
  bool get hasReportBody =>
      headline.isNotEmpty ||
      summary.isNotEmpty ||
      findings.isNotEmpty ||
      risks.isNotEmpty ||
      actions.isNotEmpty ||
      matchedProviders.isNotEmpty;

  factory WorkspaceAnalysis.fromJson(Map<String, dynamic> json) {
    final rawStatus = '${json['status'] ?? ''}'.toUpperCase();
    final rawContext = json['context'];
    return WorkspaceAnalysis(
      id: json['id'] as String? ?? '',
      documentId: json['documentId'] as String? ?? '',
      question: '${json['question'] ?? ''}'.trim(),
      status: const [kAnalysisPending, kAnalysisReady, kAnalysisFailed]
              .contains(rawStatus)
          ? rawStatus
          : kAnalysisReady,
      headline: '${json['headline'] ?? ''}'.trim(),
      summary: '${json['summary'] ?? ''}'.trim(),
      findings: (json['findings'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => AnalysisFinding.fromJson(e.cast<String, dynamic>()))
          .where((f) => f.title.isNotEmpty || f.detail.isNotEmpty)
          .toList(growable: false),
      risks: parseWorkspaceStringList(json['risks']),
      actions: parseWorkspaceStringList(json['actions']),
      suggestedSkills: parseWorkspaceStringList(json['suggestedSkills']),
      matchedProviders: (json['matchedProviders'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => MatchedProvider.fromJson(e.cast<String, dynamic>()))
          .where((p) => p.name.isNotEmpty)
          .toList(growable: false),
      context: rawContext is Map
          ? AnalysisContext.fromJson(rawContext.cast<String, dynamic>())
          : null,
      aiGenerated: json['aiGenerated'] as bool? ?? false,
      createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
    );
  }
}

/// Ints arrive as int, double or string depending on the serializer. A blind
/// `as int` blows up on the last two.
int parseWorkspaceInt(Object? raw) {
  if (raw is int) return raw;
  if (raw is num) return raw.round();
  return int.tryParse('${raw ?? ''}'.trim()) ??
      double.tryParse('${raw ?? ''}'.trim())?.round() ??
      0;
}

/// Tolerates nulls and non-string entries, and drops blanks — an empty bullet
/// renders as a numbered line with nothing after it, which reads as a bug
/// rather than as a missing item.
List<String> parseWorkspaceStringList(Object? raw) {
  if (raw is! List) return const [];
  return raw
      .map((e) => '${e ?? ''}'.trim())
      .where((e) => e.isNotEmpty)
      .toList(growable: false);
}
