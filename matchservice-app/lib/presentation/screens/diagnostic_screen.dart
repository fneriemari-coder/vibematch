import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/models/diagnostic_models.dart';
import '../../data/repositories/diagnostic_repository.dart';
import '../widgets/pillar_radar_chart.dart';
import '../widgets/vibe_ui.dart';

/// The diagnostic composer and its history.
///
/// A manager writes, in their own words, what is going wrong. The backend
/// scores four pillars, names the weakest one, and hands back both the
/// recommendations and the skills to hire for — which is what turns a
/// complaint into a brief. Past diagnostics stay listed so progress over time
/// is visible rather than each reading being a one-off.
class DiagnosticScreen extends StatefulWidget {
  const DiagnosticScreen({super.key, required this.diagnosticRepository});

  final DiagnosticRepository diagnosticRepository;

  @override
  State<DiagnosticScreen> createState() => _DiagnosticScreenState();
}

class _DiagnosticScreenState extends State<DiagnosticScreen> {
  final _situationController = TextEditingController();

  bool _submitting = false;
  bool _historyLoading = true;
  String? _historyError;
  List<Diagnostic> _history = const [];

  @override
  void initState() {
    super.initState();
    _situationController.addListener(_onSituationChanged);
    _loadHistory();
  }

  @override
  void dispose() {
    _situationController.removeListener(_onSituationChanged);
    _situationController.dispose();
    super.dispose();
  }

  /// Drives the live counter and the submit button's enabled state. Cheap
  /// enough to rebuild the (short) composer on every keystroke.
  void _onSituationChanged() => setState(() {});

  int get _charCount => _situationController.text.trim().length;

  bool get _canSubmit =>
      !_submitting &&
      _charCount >= kDiagnosticMinChars &&
      _charCount <= kDiagnosticMaxChars;

  Future<void> _loadHistory() async {
    setState(() {
      _historyLoading = true;
      _historyError = null;
    });
    try {
      final history = await widget.diagnosticRepository.listMine();
      if (!mounted) return;
      setState(() {
        _history = history;
        _historyLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _historyError = describeApiError(
          error,
          fallback: 'Não foi possível carregar seus diagnósticos anteriores.',
        );
        _historyLoading = false;
      });
    }
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;
    FocusScope.of(context).unfocus();
    setState(() => _submitting = true);
    try {
      final diagnostic = await widget.diagnosticRepository.create(
        situation: _situationController.text,
      );
      if (!mounted) return;
      setState(() => _submitting = false);
      _situationController.clear();
      await _openResult(diagnostic.id, initial: diagnostic);
      if (mounted) await _loadHistory();
    } catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: 'Não foi possível gerar o diagnóstico agora. '
                  'Seu texto continua aqui — tente de novo.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> _openResult(String id, {Diagnostic? initial}) {
    return Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => DiagnosticResultScreen(
          diagnosticId: id,
          diagnosticRepository: widget.diagnosticRepository,
          initial: initial,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Diagnóstico')),
      body: _submitting
          ? const _GeneratingView()
          : RefreshIndicator(
              onRefresh: _loadHistory,
              color: VibeMatchColors.neonPrimary,
              backgroundColor: VibeMatchColors.surface,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.only(
                  top: 24,
                  bottom: VibeMatchSpacing.sectionGap,
                ),
                children: [
                  VibeContent(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const VibeSectionHeader(
                          eyebrow: 'Diagnóstico',
                          title: 'Descubra onde o seu negócio',
                          titleAccent: 'está travando',
                          subtitle:
                              'Escreva do seu jeito. A análise lê o que você '
                              'contou, pontua os quatro pilares do negócio e '
                              'devolve o que fazer — e quem procurar para '
                              'fazer.',
                        ),
                        const SizedBox(height: 24),
                        const _PromptCard(),
                        const SizedBox(height: 16),
                        _SituationField(controller: _situationController),
                        const SizedBox(height: 10),
                        _CharacterCounter(count: _charCount),
                        const SizedBox(height: 18),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            onPressed: _canSubmit ? _submit : null,
                            icon: const Icon(Icons.insights_rounded, size: 18),
                            label: const Text('Gerar diagnóstico'),
                          ),
                        ),
                        // The button never sits greyed out in silence: when it
                        // is off, the line below says exactly what unlocks it.
                        if (!_canSubmit) ...[
                          const SizedBox(height: 10),
                          _DisabledReason(count: _charCount),
                        ],
                        const SizedBox(height: VibeMatchSpacing.sectionGap),
                        const VibeSectionHeader(
                          eyebrow: 'Histórico',
                          title: 'O que você já',
                          titleAccent: 'diagnosticou',
                          subtitle: 'Cada leitura fica guardada. Comparar duas '
                              'separadas por alguns meses é a forma mais '
                              'honesta de ver se o gargalo mudou de lugar.',
                        ),
                        const SizedBox(height: 18),
                      ],
                    ),
                  ),
                  if (_historyLoading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 48),
                      child: Center(
                        child: CircularProgressIndicator(
                          color: VibeMatchColors.neonPrimary,
                        ),
                      ),
                    )
                  else if (_historyError != null)
                    VibeErrorState(
                      message: _historyError!,
                      onRetry: _loadHistory,
                    )
                  else if (_history.isEmpty)
                    const VibeEmptyState(
                      icon: Icons.radar_rounded,
                      title: 'Nenhum diagnóstico ainda',
                      message: 'O primeiro que você gerar aparece aqui, com a '
                          'data e o pilar mais frágil daquele momento.',
                    )
                  else
                    ..._history.map(
                      (diagnostic) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: VibeContent(
                          child: _HistoryTile(
                            diagnostic: diagnostic,
                            onTap: () => _openResult(
                              diagnostic.id,
                              initial: diagnostic,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

/// The questions that draw out specifics. Without them people write "as vendas
/// estão fracas", which produces a diagnostic just as vague.
class _PromptCard extends StatelessWidget {
  const _PromptCard();

  static const List<String> _questions = [
    'O que aconteceu nos últimos 30 dias que custou dinheiro ou tempo?',
    'Quantas propostas ou clientes você perdeu — e em que ponto perdeu?',
    'O que o time refez, atrasou ou deixou cair no caminho?',
    'Quanto isso custou, em reais ou em horas?',
  ];

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.edit_note_rounded,
                size: 18,
                color: VibeMatchColors.neonPrimary,
              ),
              const SizedBox(width: 8),
              Text(
                'Responda o que puder, na ordem que quiser',
                style: VibeMatchTextStyles.subheading,
              ),
            ],
          ),
          const SizedBox(height: 14),
          ..._questions.map(
            (question) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 6),
                    child: Icon(
                      Icons.circle,
                      size: 5,
                      color: VibeMatchColors.scoreGold,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(question, style: VibeMatchTextStyles.body),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SituationField extends StatelessWidget {
  const _SituationField({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      // Long enough that the field visibly invites a few paragraphs rather
      // than a one-line answer, and it grows from there.
      minLines: 8,
      maxLines: 16,
      maxLength: kDiagnosticMaxChars,
      keyboardType: TextInputType.multiline,
      textCapitalization: TextCapitalization.sentences,
      style: VibeMatchTextStyles.readingBody.copyWith(fontSize: 15),
      decoration: const InputDecoration(
        // The counter is rendered below, with the bounds spelled out — the
        // default "0/4000" says nothing about the minimum.
        counterText: '',
        alignLabelWithHint: true,
        hintText: 'Ex.: em julho perdi três orçamentos grandes porque levei '
            'cinco dias para responder o cliente. Duas entregas voltaram para '
            'refazer e o time perdeu uma semana nisso. Fecho o mês sem saber '
            'a margem de cada contrato...',
      ),
    );
  }
}

class _CharacterCounter extends StatelessWidget {
  const _CharacterCounter({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final tooShort = count < kDiagnosticMinChars;
    final nearLimit = count > kDiagnosticMaxChars - 200;
    return Row(
      children: [
        Expanded(
          child: Text(
            tooShort
                ? 'Mínimo de $kDiagnosticMinChars caracteres'
                : nearLimit
                    ? 'Faltam ${kDiagnosticMaxChars - count} caracteres para o '
                        'limite'
                    : 'Quanto mais concreto, melhor a leitura',
            style: VibeMatchTextStyles.caption,
          ),
        ),
        const SizedBox(width: 12),
        Text(
          '$count / $kDiagnosticMaxChars',
          style: VibeMatchTextStyles.caption.copyWith(
            fontWeight: FontWeight.w700,
            color: tooShort || nearLimit
                ? VibeMatchColors.scoreGold
                : VibeMatchColors.textHigh,
          ),
        ),
      ],
    );
  }
}

class _DisabledReason extends StatelessWidget {
  const _DisabledReason({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final missing = kDiagnosticMinChars - count;
    final message = count == 0
        ? 'Escreva a sua situação acima para liberar a análise — pelo menos '
            '$kDiagnosticMinChars caracteres.'
        : missing > 0
            ? 'Faltam $missing ${missing == 1 ? 'caractere' : 'caracteres'}. '
                'Com menos de $kDiagnosticMinChars não dá para separar um '
                'gargalo de um desabafo.'
            : 'Seu texto passou de $kDiagnosticMaxChars caracteres. Corte o '
                'que for contexto e mantenha os números.';

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 1),
          child: Icon(
            Icons.info_outline_rounded,
            size: 15,
            color: VibeMatchColors.textLow,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(child: Text(message, style: VibeMatchTextStyles.caption)),
      ],
    );
  }
}

/// Honest progress while the analysis runs.
///
/// Generation takes seconds, and a bare spinner for that long reads as a hung
/// screen. This names the phases the request actually goes through and shows
/// the elapsed time, so a slow response looks slow rather than broken.
class _GeneratingView extends StatefulWidget {
  const _GeneratingView();

  @override
  State<_GeneratingView> createState() => _GeneratingViewState();
}

class _GeneratingViewState extends State<_GeneratingView> {
  static const List<String> _stages = [
    'Lendo o que você escreveu',
    'Separando fatos de impressões',
    'Pontuando vendas, gestão, tecnologia e finanças',
    'Escrevendo as recomendações e o perfil de quem contratar',
  ];

  /// Seconds after which each stage starts. The last one has no upper bound —
  /// it stays until the response lands.
  static const List<int> _stageStartsAt = [0, 3, 7, 12];

  Timer? _ticker;
  int _elapsed = 0;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(
      const Duration(seconds: 1),
      (_) => setState(() => _elapsed++),
    );
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  int get _currentStage {
    var stage = 0;
    for (var i = 0; i < _stageStartsAt.length; i++) {
      if (_elapsed >= _stageStartsAt[i]) stage = i;
    }
    return stage;
  }

  @override
  Widget build(BuildContext context) {
    final current = _currentStage;

    return VibeContent(
      child: Center(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('ANALISANDO', style: VibeMatchTextStyles.eyebrow),
              const SizedBox(height: 10),
              Text(
                'Lendo a sua situação',
                style: VibeMatchTextStyles.sectionTitle,
              ),
              const SizedBox(height: 20),
              ClipRRect(
                borderRadius: VibeMatchRadii.pillRadius,
                child: const LinearProgressIndicator(
                  minHeight: 4,
                  backgroundColor: VibeMatchColors.slate,
                  valueColor: AlwaysStoppedAnimation<Color>(
                    VibeMatchColors.neonPrimary,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              for (var i = 0; i < _stages.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 20,
                        height: 20,
                        child: i < current
                            ? const Icon(
                                Icons.check_circle_rounded,
                                size: 18,
                                color: VibeMatchColors.positive,
                              )
                            : i == current
                                ? const Padding(
                                    padding: EdgeInsets.all(2),
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: VibeMatchColors.neonPrimary,
                                    ),
                                  )
                                : const Icon(
                                    Icons.circle_outlined,
                                    size: 16,
                                    color: VibeMatchColors.slate,
                                  ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          _stages[i],
                          style: i <= current
                              ? VibeMatchTextStyles.body.copyWith(
                                  color: VibeMatchColors.textHigh,
                                )
                              : VibeMatchTextStyles.body,
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 8),
              Text(
                '${_elapsed}s — normalmente leva entre 10 e 30 segundos. '
                'Não feche a tela.',
                style: VibeMatchTextStyles.caption,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HistoryTile extends StatelessWidget {
  const _HistoryTile({required this.diagnostic, required this.onTap});

  final Diagnostic diagnostic;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final headline = diagnostic.summary.trim().isNotEmpty
        ? diagnostic.summary.trim()
        : diagnostic.situation.trim();

    return VibeCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  diagnostic.createdAt == null
                      ? 'Diagnóstico'
                      : formatFullDate(diagnostic.createdAt!),
                  style: VibeMatchTextStyles.caption.copyWith(
                    color: VibeMatchColors.scoreGold,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              _SourceTag(aiGenerated: diagnostic.aiGenerated),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Pilar mais frágil: ${diagnostic.weakestPillarLabel} '
            '(${diagnostic.weakestScore.round()}/100)',
            style: VibeMatchTextStyles.subheading,
          ),
          if (headline.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              headline,
              style: VibeMatchTextStyles.body,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Text(
                'Abrir leitura completa',
                style: VibeMatchTextStyles.caption.copyWith(
                  color: VibeMatchColors.neonPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 5),
              const Icon(
                Icons.arrow_forward_rounded,
                size: 14,
                color: VibeMatchColors.neonPrimary,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Says which engine produced the reading. Never hidden: a local fallback
/// scored by rules is a different claim from one written by the model, and the
/// reader is entitled to know which they are acting on.
class _SourceTag extends StatelessWidget {
  const _SourceTag({required this.aiGenerated});

  final bool aiGenerated;

  @override
  Widget build(BuildContext context) {
    return VibeTag(
      label: aiGenerated ? 'IA' : 'Análise local',
      icon: aiGenerated ? Icons.auto_awesome_rounded : Icons.calculate_outlined,
      color:
          aiGenerated ? VibeMatchColors.neonPrimary : VibeMatchColors.textLow,
    );
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/// The reading itself. Opened straight after generation with the fresh object
/// in hand, or from the history with only an id — in which case it fetches.
class DiagnosticResultScreen extends StatefulWidget {
  const DiagnosticResultScreen({
    super.key,
    required this.diagnosticId,
    required this.diagnosticRepository,
    this.initial,
  });

  final String diagnosticId;
  final DiagnosticRepository diagnosticRepository;

  /// Already-loaded diagnostic, when the caller has one. Skips the fetch so
  /// the radar animates the moment the route opens.
  final Diagnostic? initial;

  @override
  State<DiagnosticResultScreen> createState() => _DiagnosticResultScreenState();
}

class _DiagnosticResultScreenState extends State<DiagnosticResultScreen> {
  Diagnostic? _diagnostic;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _diagnostic = widget.initial;
    if (_diagnostic == null) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final diagnostic =
          await widget.diagnosticRepository.getById(widget.diagnosticId);
      if (!mounted) return;
      setState(() {
        _diagnostic = diagnostic;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível carregar este diagnóstico.',
        );
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final diagnostic = _diagnostic;

    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Seu diagnóstico')),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(
                color: VibeMatchColors.neonPrimary,
              ),
            )
          : _error != null
              ? VibeErrorState(message: _error!, onRetry: _load)
              : diagnostic == null
                  ? const VibeEmptyState(
                      icon: Icons.radar_rounded,
                      title: 'Diagnóstico indisponível',
                      message: 'Esta leitura não está mais acessível. Gere uma '
                          'nova a partir da sua situação atual.',
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: VibeMatchColors.neonPrimary,
                      backgroundColor: VibeMatchColors.surface,
                      child: _DiagnosticBody(diagnostic: diagnostic),
                    ),
    );
  }
}

class _DiagnosticBody extends StatelessWidget {
  const _DiagnosticBody({required this.diagnostic});

  final Diagnostic diagnostic;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(
        top: 24,
        bottom: VibeMatchSpacing.sectionGap,
      ),
      children: [
        VibeContent(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      diagnostic.createdAt == null
                          ? 'LEITURA DO SEU NEGÓCIO'
                          : formatFullDate(diagnostic.createdAt!).toUpperCase(),
                      style: VibeMatchTextStyles.eyebrow,
                    ),
                  ),
                  _SourceTag(aiGenerated: diagnostic.aiGenerated),
                ],
              ),
              const SizedBox(height: 18),
              _RadarCard(diagnostic: diagnostic),
              const SizedBox(height: VibeMatchSpacing.sectionGap),

              // The finding, not a verdict: the score says where the pressure
              // is highest right now, not that the business is bad at it.
              VibeSectionHeader(
                eyebrow: 'O que mais pesa agora',
                title: 'O gargalo aparece em',
                titleAccent: diagnostic.weakestPillarLabel,
                subtitle:
                    'Foi o pilar com a menor pontuação — ${diagnostic.weakestScore.round()} '
                    'de 100 — no que você descreveu. '
                    '${diagnosticPillarDescriptions[diagnostic.weakestPillar] ?? ''}',
              ),

              if (diagnostic.summary.trim().isNotEmpty) ...[
                const SizedBox(height: 22),
                Text(
                  diagnostic.summary.trim(),
                  style: VibeMatchTextStyles.readingBody,
                ),
              ],

              if (diagnostic.recommendations.isNotEmpty) ...[
                const SizedBox(height: VibeMatchSpacing.sectionGap),
                const VibeSectionHeader(
                  eyebrow: 'Plano',
                  title: 'Por onde',
                  titleAccent: 'começar',
                  subtitle: 'Em ordem. A primeira linha é a que destrava as '
                      'outras.',
                ),
                const SizedBox(height: 20),
                for (var i = 0; i < diagnostic.recommendations.length; i++)
                  _RecommendationRow(
                    index: i + 1,
                    text: diagnostic.recommendations[i],
                  ),
              ],

              if (diagnostic.suggestedSkills.isNotEmpty) ...[
                const SizedBox(height: VibeMatchSpacing.sectionGap),
                const VibeSectionHeader(
                  eyebrow: 'Briefing de contratação',
                  title: 'O que procurar em',
                  titleAccent: 'quem você contratar',
                  subtitle:
                      'Estas são as competências que resolvem o gargalo acima. '
                      'Use-as como filtro ao buscar um profissional ou um '
                      'mentor na plataforma.',
                ),
                const SizedBox(height: 18),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: diagnostic.suggestedSkills
                      .map((skill) => VibeTag(label: skill))
                      .toList(),
                ),
              ],

              if (diagnostic.situation.trim().isNotEmpty) ...[
                const SizedBox(height: VibeMatchSpacing.sectionGap),
                _SituationRecap(situation: diagnostic.situation.trim()),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _RadarCard extends StatelessWidget {
  const _RadarCard({required this.diagnostic});

  final Diagnostic diagnostic;

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Text(
                  'Os quatro pilares',
                  style: VibeMatchTextStyles.heading,
                ),
              ),
              VibeStat(
                value: '${diagnostic.pillars.average.round()}',
                unit: '/100',
                caption: 'média geral',
                size: 30,
              ),
            ],
          ),
          const SizedBox(height: 18),
          PillarRadarChart(
            pillars: diagnostic.pillars,
            highlightPillar: diagnostic.weakestPillar,
          ),
          const SizedBox(height: 18),
          const Divider(color: VibeMatchColors.border, height: 1),
          const SizedBox(height: 16),
          for (final key in diagnosticPillarKeys)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _PillarLegendRow(
                label: diagnosticPillarLabel(key),
                description: diagnosticPillarDescriptions[key] ?? '',
                score: diagnostic.pillars.scoreFor(key),
                weakest: key == diagnostic.weakestPillar,
              ),
            ),
        ],
      ),
    );
  }
}

class _PillarLegendRow extends StatelessWidget {
  const _PillarLegendRow({
    required this.label,
    required this.description,
    required this.score,
    required this.weakest,
  });

  final String label;
  final String description;
  final double score;
  final bool weakest;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 40,
          child: Text(
            '${score.round()}',
            style: VibeMatchTextStyles.subheading.copyWith(
              color: weakest
                  ? VibeMatchColors.scoreGold
                  : VibeMatchColors.textHigh,
            ),
          ),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: VibeMatchTextStyles.caption.copyWith(
                  color: VibeMatchColors.textHigh,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (description.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(description, style: VibeMatchTextStyles.caption),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _RecommendationRow extends StatelessWidget {
  const _RecommendationRow({required this.index, required this.text});

  final int index;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: VibeMatchColors.neonPrimary.withOpacity(0.14),
              border: Border.all(
                color: VibeMatchColors.neonPrimary.withOpacity(0.5),
              ),
            ),
            child: Text(
              '$index',
              style: VibeMatchTextStyles.caption.copyWith(
                color: VibeMatchColors.neonPrimary,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                text,
                style: VibeMatchTextStyles.readingBody.copyWith(fontSize: 15),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// What the reading was based on. Collapsed by default — it is the user's own
/// text, useful for checking the analysis against, not for re-reading first.
class _SituationRecap extends StatelessWidget {
  const _SituationRecap({required this.situation});

  final String situation;

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      child: Theme(
        // ExpansionTile paints its own divider lines in the base dark theme;
        // the card already has a border, so they are removed here.
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 18),
          childrenPadding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
          iconColor: VibeMatchColors.neonPrimary,
          collapsedIconColor: VibeMatchColors.textLow,
          title: Text(
            'O que você escreveu',
            style: VibeMatchTextStyles.subheading,
          ),
          subtitle: Text(
            'A base desta leitura',
            style: VibeMatchTextStyles.caption,
          ),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: Text(situation, style: VibeMatchTextStyles.body),
            ),
          ],
        ),
      ),
    );
  }
}
