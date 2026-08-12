import 'dart:async';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/models/workspace_models.dart';
import '../../data/repositories/workspace_repository.dart';
import '../widgets/score_badge.dart';
import '../widgets/vibe_ui.dart';

/// Copiloto — the AI workspace.
///
/// The ask was: "um local onde ele joga um arquivo e a IA analise e lhe dê
/// informações de acordo com o que ele buscar… e entregue de uma forma
/// impressionante que ele não teria em outro lugar."
///
/// The last clause is the whole design brief. Any chatbot can summarise a
/// contract; what none of them can do is finish the sentence with *who on this
/// platform fixes it*, priced, scored and one tap away. So the analysis is laid
/// out as a report — headline, findings with the quoted evidence, risks,
/// numbered actions — and it ends on `matchedProviders`, which gets the same
/// visual weight as the findings rather than being a footnote.
class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({super.key, required this.workspaceRepository});

  final WorkspaceRepository workspaceRepository;

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

/// The three questions the empty state teaches with. They are deliberately the
/// questions someone would not think to type — "o que este relatório não está
/// me contando" is the one that demonstrates the product.
const List<String> _exampleQuestions = <String>[
  'Que cláusulas faltam neste contrato?',
  'Onde estou perdendo margem?',
  'O que este relatório não está me contando?',
];

class _WorkspaceScreenState extends State<WorkspaceScreen> {
  bool _loading = true;
  String? _error;
  List<WorkspaceDocument> _documents = const [];

  /// Set when someone taps an example question before there is any document to
  /// ask it of. It rides along to the next document opened, so the tap is never
  /// swallowed.
  String? _pendingQuestion;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final documents = await widget.workspaceRepository.listDocuments();
      if (!mounted) return;
      setState(() {
        _documents = documents;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível carregar os seus documentos.',
        );
        _loading = false;
      });
    }
  }

  Future<void> _openDocument(WorkspaceDocument document) async {
    final question = _pendingQuestion;
    setState(() => _pendingQuestion = null);
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => WorkspaceDocumentScreen(
          documentId: document.id,
          workspaceRepository: widget.workspaceRepository,
          initial: document,
          initialQuestion: question,
        ),
      ),
    );
    if (mounted) await _load();
  }

  Future<void> _addDocument() async {
    final created = await showModalBottomSheet<WorkspaceDocument>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AddDocumentSheet(
        workspaceRepository: widget.workspaceRepository,
      ),
    );
    if (created == null || !mounted) return;
    setState(() => _documents = [created, ..._documents]);
    await _openDocument(created);
  }

  void _prefillAndAdd(String question) {
    setState(() => _pendingQuestion = question);
    _addDocument();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Copiloto')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'workspace-add',
        onPressed: _addDocument,
        backgroundColor: VibeMatchColors.neonPrimary,
        foregroundColor: VibeMatchColors.ink,
        icon: const Icon(Icons.note_add_rounded),
        label: Text(
          'Novo documento',
          style: VibeMatchTextStyles.button.copyWith(
            color: VibeMatchColors.ink,
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: VibeMatchColors.neonPrimary,
        backgroundColor: VibeMatchColors.surface,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(top: 24, bottom: 120),
          children: [
            VibeContent(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const VibeSectionHeader(
                    eyebrow: 'Copiloto',
                    title: 'Traga o documento.',
                    titleAccent: 'Pergunte o que importa.',
                    subtitle:
                        'Contrato, proposta, relatório, planilha exportada. '
                        'O Copiloto lê, responde exatamente o que você '
                        'perguntar — e termina dizendo quem, aqui dentro, '
                        'resolve o que ele encontrou.',
                  ),
                  const SizedBox(height: 22),
                  const _HowItWorksStrip(),
                  const SizedBox(height: VibeMatchSpacing.sectionGap),
                  VibeSectionHeader(
                    eyebrow: 'Seus documentos',
                    title: 'O que já está',
                    titleAccent: 'na mesa',
                    subtitle: _documents.isEmpty
                        ? null
                        : '${_documents.length} '
                            '${_documents.length == 1 ? 'documento' : 'documentos'}. '
                            'Cada um guarda todas as perguntas que você já fez '
                            'sobre ele.',
                  ),
                  const SizedBox(height: 18),
                ],
              ),
            ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 56),
                child: Center(
                  child: CircularProgressIndicator(
                    color: VibeMatchColors.neonPrimary,
                  ),
                ),
              )
            else if (_error != null)
              VibeErrorState(message: _error!, onRetry: _load)
            else if (_documents.isEmpty)
              VibeContent(
                child: _WorkspaceEmptyState(
                  onExampleTap: _prefillAndAdd,
                  onAdd: _addDocument,
                ),
              )
            else
              ..._documents.map(
                (document) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: VibeContent(
                    child: _DocumentTile(
                      document: document,
                      onTap: () => _openDocument(document),
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

/// Three steps, stated plainly. The screen is doing something people have not
/// seen in this app before, and a wall of buttons with no explanation is how a
/// feature like this goes unused.
class _HowItWorksStrip extends StatelessWidget {
  const _HowItWorksStrip();

  static const List<(IconData, String, String)> _steps = [
    (
      Icons.upload_file_rounded,
      'Traga o texto',
      'Cole o contrato ou o relatório. Fica guardado na sua conta.',
    ),
    (
      Icons.help_outline_rounded,
      'Pergunte',
      'Uma pergunta direta, do jeito que você faria a um sócio.',
    ),
    (
      Icons.groups_2_rounded,
      'Receba e aja',
      'Um laudo com achados, riscos, ordem de execução — e quem contratar.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth > 640;
        final cards = [
          for (var i = 0; i < _steps.length; i++)
            _StepCard(
              index: i + 1,
              icon: _steps[i].$1,
              title: _steps[i].$2,
              body: _steps[i].$3,
            ),
        ];
        if (!wide) {
          return Column(
            children: [
              for (var i = 0; i < cards.length; i++) ...[
                if (i > 0) const SizedBox(height: 10),
                cards[i],
              ],
            ],
          );
        }
        // IntrinsicHeight, not a bare stretch: the strip lives inside a
        // ListView, so the row's own height is unbounded and stretching
        // children into it asserts. This measures the tallest card first and
        // lets the other two match it — which is the point of the treatment.
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < cards.length; i++) ...[
                if (i > 0) const SizedBox(width: 12),
                Expanded(child: cards[i]),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _StepCard extends StatelessWidget {
  const _StepCard({
    required this.index,
    required this.icon,
    required this.title,
    required this.body,
  });

  final int index;
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 17, color: VibeMatchColors.neonPrimary),
              const SizedBox(width: 8),
              Text(
                '$index',
                style: VibeMatchTextStyles.caption.copyWith(
                  color: VibeMatchColors.scoreGold,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(title, style: VibeMatchTextStyles.subheading),
          const SizedBox(height: 5),
          Text(body, style: VibeMatchTextStyles.caption),
        ],
      ),
    );
  }
}

/// Empty state that teaches rather than apologises: it shows the three
/// questions worth asking, and tapping one carries straight into the composer
/// with that question already loaded.
class _WorkspaceEmptyState extends StatelessWidget {
  const _WorkspaceEmptyState({
    required this.onExampleTap,
    required this.onAdd,
  });

  final ValueChanged<String> onExampleTap;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.auto_awesome_rounded,
                size: 18,
                color: VibeMatchColors.neonPrimary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Nenhum documento ainda',
                  style: VibeMatchTextStyles.heading,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Comece por uma destas — são as perguntas que costumam devolver '
            'dinheiro. Toque em uma e cole o documento na sequência.',
            style: VibeMatchTextStyles.body,
          ),
          const SizedBox(height: 18),
          for (final question in _exampleQuestions)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _ExampleQuestionRow(
                question: question,
                onTap: () => onExampleTap(question),
              ),
            ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.note_add_rounded, size: 17),
            label: const Text('Trazer um documento'),
          ),
        ],
      ),
    );
  }
}

class _ExampleQuestionRow extends StatelessWidget {
  const _ExampleQuestionRow({required this.question, required this.onTap});

  final String question;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: VibeMatchColors.slate.withOpacity(0.55),
      borderRadius: VibeMatchRadii.buttonRadius,
      child: InkWell(
        onTap: onTap,
        borderRadius: VibeMatchRadii.buttonRadius,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          child: Row(
            children: [
              const Icon(
                Icons.format_quote_rounded,
                size: 16,
                color: VibeMatchColors.scoreGold,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  question,
                  style: VibeMatchTextStyles.body.copyWith(
                    color: VibeMatchColors.textHigh,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              const Icon(
                Icons.arrow_forward_rounded,
                size: 15,
                color: VibeMatchColors.neonPrimary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({required this.document, required this.onTap});

  final WorkspaceDocument document;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final analyses = document.analyses.length;
    return VibeCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: SizedBox(
              width: 62,
              height: 78,
              // The generated cover doing its job: a document with no preview
              // still arrives on the row as an object with a face.
              child: VibeCover(
                seed: document.id.isEmpty ? document.filename : document.id,
                height: 78,
                icon: _kindIcon(document.kind),
                label: document.kindLabel,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  document.filename,
                  style: VibeMatchTextStyles.cardTitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    VibeTag(
                      label: document.kindLabel,
                      color: VibeMatchColors.scoreGold,
                    ),
                    Text(
                      formatBytes(document.sizeBytes),
                      style: VibeMatchTextStyles.caption,
                    ),
                    Text(
                      '${formatCount(document.charCount)} caracteres',
                      style: VibeMatchTextStyles.caption,
                    ),
                    if (document.createdAt != null)
                      Text(
                        formatRelativeDate(document.createdAt!),
                        style: VibeMatchTextStyles.caption,
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Icon(
                      analyses > 0
                          ? Icons.insights_rounded
                          : Icons.help_outline_rounded,
                      size: 14,
                      color: analyses > 0
                          ? VibeMatchColors.neonPrimary
                          : VibeMatchColors.textLow,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        analyses == 0
                            ? 'Nenhuma pergunta ainda — abra e pergunte'
                            : '$analyses ${analyses == 1 ? 'análise' : 'análises'}',
                        style: VibeMatchTextStyles.caption.copyWith(
                          color: analyses > 0
                              ? VibeMatchColors.neonPrimary
                              : VibeMatchColors.textLow,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// `package:collection`'s `firstWhereOrNull` without taking a dependency on a
/// package this project does not declare.
T? _firstWhereOrNull<T>(Iterable<T> items, bool Function(T) test) {
  for (final item in items) {
    if (test(item)) return item;
  }
  return null;
}

IconData _kindIcon(String kind) => switch (kind.toUpperCase()) {
      'CONTRATO' => Icons.gavel_rounded,
      'PROPOSTA' => Icons.handshake_rounded,
      'FINANCEIRO' => Icons.account_balance_rounded,
      'PLANILHA' => Icons.table_chart_rounded,
      'RELATORIO' => Icons.assessment_rounded,
      _ => Icons.description_rounded,
    };

// ---------------------------------------------------------------------------
// Adding a document
// ---------------------------------------------------------------------------

/// The composer.
///
/// There is no `file_picker` in this project and there is no way to open a
/// native file dialog from pure Dart on web without `dart:html`, which breaks
/// the mobile build. So the document arrives as pasted text, uploaded as
/// `text/plain` bytes through the same multipart endpoint a real picker would
/// use — identical on every platform, and genuinely the fastest route for
/// someone who already has the contract open in another tab.
class _AddDocumentSheet extends StatefulWidget {
  const _AddDocumentSheet({required this.workspaceRepository});

  final WorkspaceRepository workspaceRepository;

  @override
  State<_AddDocumentSheet> createState() => _AddDocumentSheetState();
}

class _AddDocumentSheetState extends State<_AddDocumentSheet> {
  /// Below this a "document" is a sentence, and every analysis of it would be
  /// the model guessing. Cheaper to say so here than to spend an API call.
  static const int _minChars = 120;

  final _filenameController = TextEditingController();
  final _contentController = TextEditingController();

  bool _uploading = false;
  String? _error;

  /// Set when the user picked a real file. Its bytes are uploaded verbatim —
  /// a PDF must reach the server as a PDF, since the extractor parses it
  /// there; decoding it to text here would corrupt it.
  Uint8List? _pickedBytes;
  String? _pickedMimeType;

  @override
  void initState() {
    super.initState();
    _filenameController.text = _defaultFilename();
    _contentController.addListener(_onChanged);
  }

  @override
  void dispose() {
    _contentController.removeListener(_onChanged);
    _filenameController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  void _onChanged() => setState(() {});

  static String _defaultFilename() {
    final now = DateTime.now();
    final day = now.day.toString().padLeft(2, '0');
    final month = now.month.toString().padLeft(2, '0');
    return 'documento-$day-$month-${now.year}.txt';
  }

  String get _content => _contentController.text.trim();

  int get _charCount => _content.length;

  /// Whatever will actually be sent — the picked file's bytes when there is
  /// one, otherwise the pasted text. The 10 MB ceiling has to be measured on
  /// the real payload, not on the text field alone.
  int get _byteCount => _pickedBytes?.length ?? utf8.encode(_content).length;

  bool get _tooBig => _byteCount > kWorkspaceMaxUploadBytes;

  /// A picked file is already a document — the character floor only guards
  /// against someone pasting a sentence and calling it a report.
  bool get _canSubmit =>
      !_uploading &&
      !_tooBig &&
      (_pickedBytes != null || _charCount >= _minChars);

  /// The endpoint keys off the MIME type, and a name with no extension makes
  /// the document list unreadable later. Both are repaired silently rather
  /// than rejected.
  String get _filename {
    final raw = _filenameController.text.trim();
    if (raw.isEmpty) return _defaultFilename();
    final lower = raw.toLowerCase();
    const knownTextExtensions = ['.txt', '.md', '.csv', '.json'];
    if (knownTextExtensions.any(lower.endsWith)) return raw;
    return '$raw.txt';
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text;
    if (!mounted) return;
    if (text == null || text.trim().isEmpty) {
      setState(() => _error = 'Não há texto na área de transferência.');
      return;
    }
    setState(() {
      _error = null;
      _contentController.text = text;
      _contentController.selection = TextSelection.collapsed(
        offset: text.length,
      );
    });
  }

  /// Real file selection. `withData: true` is required on every platform we
  /// ship: the web build has no filesystem path at all, and reading bytes up
  /// front keeps a single upload path for both routes.
  Future<void> _pickFile() async {
    try {
      final result = await FilePicker.pickFiles(
        withData: true,
        type: FileType.custom,
        allowedExtensions: const ['txt', 'md', 'csv', 'json', 'pdf'],
      );
      final file = result?.files.singleOrNull;
      if (file == null) return;
      final bytes = file.bytes;
      if (bytes == null) {
        setState(() => _error = 'Não foi possível ler esse arquivo.');
        return;
      }
      setState(() {
        _pickedBytes = bytes;
        _pickedMimeType = _mimeTypeFor(file.extension);
        _filenameController.text = file.name;
        // A picked file replaces anything pasted, so the sheet never holds two
        // competing sources with no way to tell which will be sent.
        _contentController.text = '';
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = 'Não foi possível abrir o seletor de arquivos.');
    }
  }

  static String _mimeTypeFor(String? extension) =>
      switch (extension?.toLowerCase()) {
        'pdf' => 'application/pdf',
        'csv' => 'text/csv',
        'json' => 'application/json',
        'md' => 'text/markdown',
        _ => 'text/plain',
      };

  Future<void> _submit() async {
    if (!_canSubmit) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      final picked = _pickedBytes;
      final document = await widget.workspaceRepository.uploadDocument(
        bytes: picked ?? utf8.encode(_content),
        filename: _filename,
        mimeType:
            picked != null ? (_pickedMimeType ?? 'text/plain') : 'text/plain',
      );
      if (!mounted) return;
      Navigator.of(context).pop(document);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _error = describeApiError(
          error,
          fallback: 'Não foi possível enviar o documento. Seu texto continua '
              'aqui — tente de novo.',
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final insets = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: insets),
      child: Container(
        decoration: const BoxDecoration(
          color: VibeMatchColors.surface,
          border: Border(top: BorderSide(color: VibeMatchColors.border)),
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.9,
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Center(
                  child: Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: VibeMatchColors.slate,
                      borderRadius: VibeMatchRadii.pillRadius,
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Text('NOVO DOCUMENTO', style: VibeMatchTextStyles.eyebrow),
                const SizedBox(height: 8),
                Text(
                  'Cole o conteúdo',
                  style: VibeMatchTextStyles.sectionTitle,
                ),
                const SizedBox(height: 8),
                Text(
                  'Abra o contrato, a proposta ou o relatório, selecione tudo e '
                  'cole aqui. O texto é enviado como arquivo .txt e fica '
                  'guardado na sua conta para quantas perguntas você quiser.',
                  style: VibeMatchTextStyles.body,
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: _filenameController,
                  textInputAction: TextInputAction.next,
                  style: VibeMatchTextStyles.body.copyWith(
                    color: VibeMatchColors.textHigh,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Nome do documento',
                    hintText: 'contrato-fornecedor.txt',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _contentController,
                  minLines: 8,
                  maxLines: 18,
                  keyboardType: TextInputType.multiline,
                  style: VibeMatchTextStyles.readingBody.copyWith(fontSize: 14),
                  decoration: const InputDecoration(
                    alignLabelWithHint: true,
                    hintText: 'Cole aqui o texto completo. Quanto mais inteiro '
                        'estiver — cláusulas, números, datas — mais específica '
                        'fica a análise.',
                  ),
                ),
                const SizedBox(height: 10),
                // A Wrap, not a Row: the paste button's label plus the counter
                // is more than a 360dp phone has room for once the user bumps
                // the system text size, and a clipped counter is worse than a
                // second line.
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 12,
                  runSpacing: 4,
                  children: [
                    TextButton.icon(
                      onPressed: _uploading ? null : _pickFile,
                      icon: const Icon(Icons.attach_file_rounded, size: 16),
                      label: const Text('Escolher arquivo'),
                    ),
                    TextButton.icon(
                      onPressed: _uploading ? null : _pasteFromClipboard,
                      icon: const Icon(Icons.content_paste_rounded, size: 16),
                      label: const Text('Colar texto'),
                    ),
                    Text(
                      '${formatCount(_charCount)} car. · '
                      '${formatBytes(_byteCount)}',
                      style: VibeMatchTextStyles.caption.copyWith(
                        fontWeight: FontWeight.w700,
                        color: _tooBig
                            ? VibeMatchColors.negative
                            : VibeMatchColors.textLow,
                      ),
                    ),
                  ],
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  _InlineNotice(
                    icon: Icons.error_outline_rounded,
                    tone: VibeMatchColors.negative,
                    message: _error!,
                  ),
                ],
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: _canSubmit ? _submit : null,
                    icon: _uploading
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: VibeMatchColors.ink,
                            ),
                          )
                        : const Icon(Icons.upload_rounded, size: 18),
                    label: Text(
                      _uploading ? 'Enviando...' : 'Enviar documento',
                    ),
                  ),
                ),
                if (!_canSubmit && !_uploading) ...[
                  const SizedBox(height: 10),
                  _InlineNotice(
                    icon: Icons.info_outline_rounded,
                    tone: VibeMatchColors.textLow,
                    message: _tooBig
                        ? 'O documento passou de '
                            '${formatBytes(kWorkspaceMaxUploadBytes)}, o limite '
                            'do envio. Divida-o em partes.'
                        : _charCount == 0
                            ? 'Cole o conteúdo acima para liberar o envio — '
                                'pelo menos $_minChars caracteres.'
                            : 'Faltam ${_minChars - _charCount} caracteres. '
                                'Com menos que isso a análise vira chute.',
                  ),
                ],
                const SizedBox(height: 14),
                Text(
                  'O envio aceita ${kWorkspaceAcceptedMimeTypes.length} formatos '
                  '(texto, CSV, Markdown, JSON e PDF) até '
                  '${formatBytes(kWorkspaceMaxUploadBytes)}. Este aplicativo '
                  'ainda envia apenas texto colado — a seleção de arquivo do '
                  'sistema chega junto com o seletor nativo.',
                  style: VibeMatchTextStyles.caption,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({
    required this.icon,
    required this.tone,
    required this.message,
  });

  final IconData icon;
  final Color tone;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(icon, size: 15, color: tone),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            message,
            style: VibeMatchTextStyles.caption.copyWith(color: tone),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// One document: ask, read, revisit
// ---------------------------------------------------------------------------

/// The document view: what it is, the ask box, the current report, and every
/// answer already written about it.
class WorkspaceDocumentScreen extends StatefulWidget {
  const WorkspaceDocumentScreen({
    super.key,
    required this.documentId,
    required this.workspaceRepository,
    this.initial,
    this.initialQuestion,
  });

  final String documentId;
  final WorkspaceRepository workspaceRepository;

  /// Already-loaded document, when the caller has one. The screen still
  /// refetches, because the list endpoint does not carry `analyses[]` — but it
  /// renders the header immediately instead of opening on a spinner.
  final WorkspaceDocument? initial;

  /// Question tapped on the empty state before this document existed.
  final String? initialQuestion;

  @override
  State<WorkspaceDocumentScreen> createState() =>
      _WorkspaceDocumentScreenState();
}

class _WorkspaceDocumentScreenState extends State<WorkspaceDocumentScreen> {
  final _questionController = TextEditingController();
  final _scrollController = ScrollController();

  WorkspaceDocument? _document;
  bool _loading = false;
  String? _error;

  bool _analysing = false;
  String? _analyseError;

  /// The analysis currently on screen. Defaults to the newest; changes when a
  /// history entry is tapped.
  WorkspaceAnalysis? _selected;

  @override
  void initState() {
    super.initState();
    _document = widget.initial;
    final question = widget.initialQuestion;
    if (question != null) _questionController.text = question;
    _questionController.addListener(_onQuestionChanged);
    _load();
  }

  @override
  void dispose() {
    _questionController.removeListener(_onQuestionChanged);
    _questionController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _onQuestionChanged() => setState(() {});

  int get _questionLength => _questionController.text.trim().length;

  bool get _canAsk =>
      !_analysing &&
      _questionLength >= kWorkspaceQuestionMinChars &&
      _questionLength <= kWorkspaceQuestionMaxChars;

  Future<void> _load() async {
    setState(() {
      _loading = _document == null;
      _error = null;
    });
    try {
      final document =
          await widget.workspaceRepository.getDocument(widget.documentId);
      if (!mounted) return;
      setState(() {
        _document = document;
        _loading = false;
        // Keep whatever the reader was looking at if it is still there;
        // otherwise fall to the newest answer.
        final selectedId = _selected?.id;
        final ordered = document.analysesNewestFirst;
        _selected = _firstWhereOrNull(ordered, (a) => a.id == selectedId) ??
            (ordered.isEmpty ? null : ordered.first);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (_document == null) {
          _error = describeApiError(
            error,
            fallback: 'Não foi possível carregar este documento.',
          );
        }
      });
    }
  }

  Future<void> _ask() async {
    if (!_canAsk) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _analysing = true;
      _analyseError = null;
    });
    try {
      var analysis = await widget.workspaceRepository.analyse(
        widget.documentId,
        _questionController.text,
      );
      // The contract allows PENDING to come straight back, so the screen waits
      // for the real answer rather than rendering an empty report.
      analysis = await _awaitReady(analysis);
      if (!mounted) return;
      setState(() {
        _analysing = false;
        _selected = analysis;
        _questionController.clear();
      });
      await _load();
      if (mounted && _scrollController.hasClients) {
        await _scrollController.animateTo(
          0,
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOut,
        );
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _analysing = false;
        _analyseError = describeApiError(
          error,
          fallback: 'A análise não foi concluída. Sua pergunta continua aqui — '
              'tente de novo.',
        );
      });
    }
  }

  /// Polls the document while the analysis is `PENDING`. Bounded: after the
  /// last attempt the pending object is returned as-is and the report renders
  /// its own "ainda processando" state, which is more honest than spinning
  /// forever.
  Future<WorkspaceAnalysis> _awaitReady(WorkspaceAnalysis analysis) async {
    var current = analysis;
    for (var attempt = 0; attempt < 12 && current.isPending; attempt++) {
      await Future<void>.delayed(const Duration(seconds: 2));
      if (!mounted) return current;
      final document =
          await widget.workspaceRepository.getDocument(widget.documentId);
      final match =
          _firstWhereOrNull(document.analyses, (a) => a.id == current.id);
      if (match != null) current = match;
    }
    return current;
  }

  Future<void> _confirmDelete() async {
    final document = _document;
    if (document == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: VibeMatchColors.surface,
        title: Text('Apagar documento?', style: VibeMatchTextStyles.subheading),
        content: Text(
          'O documento "${document.filename}" e todas as análises feitas sobre '
          'ele são removidos. Não dá para desfazer.',
          style: VibeMatchTextStyles.body,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Manter'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: TextButton.styleFrom(
              foregroundColor: VibeMatchColors.negative,
            ),
            child: const Text('Apagar'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await widget.workspaceRepository.deleteDocument(document.id);
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: 'Não foi possível apagar o documento agora.',
            ),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final document = _document;

    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(
        title: const Text('Copiloto'),
        actions: [
          if (document != null)
            IconButton(
              tooltip: 'Apagar documento',
              onPressed: _confirmDelete,
              icon: const Icon(Icons.delete_outline_rounded),
            ),
        ],
      ),
      body: _analysing
          ? _AnalysingView(question: _questionController.text.trim())
          : _loading
              ? const Center(
                  child: CircularProgressIndicator(
                    color: VibeMatchColors.neonPrimary,
                  ),
                )
              : _error != null
                  ? VibeErrorState(message: _error!, onRetry: _load)
                  : document == null
                      ? const VibeEmptyState(
                          icon: Icons.description_outlined,
                          title: 'Documento indisponível',
                          message: 'Este documento não está mais acessível. '
                              'Traga-o de novo pelo Copiloto.',
                        )
                      : _body(document),
    );
  }

  Widget _body(WorkspaceDocument document) {
    final history = document.analysesNewestFirst;
    final selected = _selected;

    return RefreshIndicator(
      onRefresh: _load,
      color: VibeMatchColors.neonPrimary,
      backgroundColor: VibeMatchColors.surface,
      child: ListView(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(
          top: 20,
          bottom: VibeMatchSpacing.sectionGap,
        ),
        children: [
          VibeContent(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _DocumentHeader(document: document),
                const SizedBox(height: 22),
                _AskBox(
                  controller: _questionController,
                  canAsk: _canAsk,
                  length: _questionLength,
                  onAsk: _ask,
                  onQuickPrompt: (question) {
                    _questionController.text = question;
                    _questionController.selection = TextSelection.collapsed(
                      offset: question.length,
                    );
                  },
                ),
                if (_analyseError != null) ...[
                  const SizedBox(height: 12),
                  _InlineNotice(
                    icon: Icons.error_outline_rounded,
                    tone: VibeMatchColors.negative,
                    message: _analyseError!,
                  ),
                ],
                const SizedBox(height: VibeMatchSpacing.sectionGap),
                if (selected == null)
                  const VibeEmptyState(
                    icon: Icons.psychology_alt_outlined,
                    title: 'Ainda sem análise',
                    message: 'Faça a primeira pergunta acima. A resposta vem '
                        'como laudo: achados com o trecho citado, riscos, '
                        'ordem de execução e quem pode resolver.',
                  )
                else
                  _AnalysisReport(analysis: selected),
                if (history.length > 1) ...[
                  const SizedBox(height: VibeMatchSpacing.sectionGap),
                  const VibeSectionHeader(
                    eyebrow: 'Histórico',
                    title: 'Tudo o que você já',
                    titleAccent: 'perguntou',
                    subtitle:
                        'Cada resposta fica guardada com a pergunta que a '
                        'gerou. Toque para reler.',
                  ),
                  const SizedBox(height: 16),
                  for (final analysis in history)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _HistoryTile(
                        analysis: analysis,
                        selected: analysis.id == selected?.id,
                        onTap: () {
                          setState(() => _selected = analysis);
                          if (_scrollController.hasClients) {
                            _scrollController.animateTo(
                              0,
                              duration: const Duration(milliseconds: 260),
                              curve: Curves.easeOut,
                            );
                          }
                        },
                      ),
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DocumentHeader extends StatelessWidget {
  const _DocumentHeader({required this.document});

  final WorkspaceDocument document;

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          VibeCover(
            seed: document.id.isEmpty ? document.filename : document.id,
            height: 118,
            icon: _kindIcon(document.kind),
            label: document.kindLabel,
            overlay: Align(
              alignment: Alignment.bottomLeft,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Text(
                  document.filename,
                  style: VibeMatchTextStyles.display(21),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 14,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                VibeTag(
                  label: document.kindLabel,
                  color: VibeMatchColors.scoreGold,
                ),
                _MetaBit(
                  icon: Icons.data_object_rounded,
                  text: document.mimeType,
                ),
                _MetaBit(
                  icon: Icons.sd_storage_rounded,
                  text: formatBytes(document.sizeBytes),
                ),
                _MetaBit(
                  icon: Icons.notes_rounded,
                  text: '${formatCount(document.charCount)} caracteres',
                ),
                if (document.createdAt != null)
                  _MetaBit(
                    icon: Icons.schedule_rounded,
                    text: formatRelativeDate(document.createdAt!),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MetaBit extends StatelessWidget {
  const _MetaBit({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: VibeMatchColors.textLow),
        const SizedBox(width: 5),
        Text(text, style: VibeMatchTextStyles.caption),
      ],
    );
  }
}

/// The ask box: the question field, the three example questions as chips, and
/// a button that says why it is off rather than sitting greyed out in silence.
class _AskBox extends StatelessWidget {
  const _AskBox({
    required this.controller,
    required this.canAsk,
    required this.length,
    required this.onAsk,
    required this.onQuickPrompt,
  });

  final TextEditingController controller;
  final bool canAsk;
  final int length;
  final VoidCallback onAsk;
  final ValueChanged<String> onQuickPrompt;

  @override
  Widget build(BuildContext context) {
    final missing = kWorkspaceQuestionMinChars - length;
    return VibeCard(
      highlighted: true,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.auto_awesome_rounded,
                size: 17,
                color: VibeMatchColors.neonPrimary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'O que você quer saber?',
                  style: VibeMatchTextStyles.subheading,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final question in _exampleQuestions)
                ActionChip(
                  onPressed: () => onQuickPrompt(question),
                  backgroundColor: VibeMatchColors.slate.withOpacity(0.6),
                  side: const BorderSide(color: VibeMatchColors.border),
                  label: Text(question, style: VibeMatchTextStyles.caption),
                ),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            controller: controller,
            minLines: 3,
            maxLines: 6,
            maxLength: kWorkspaceQuestionMaxChars,
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.sentences,
            style: VibeMatchTextStyles.readingBody.copyWith(fontSize: 15),
            decoration: const InputDecoration(
              counterText: '',
              alignLabelWithHint: true,
              hintText: 'Ex.: este contrato me protege se o fornecedor atrasar '
                  'a entrega? O que está faltando?',
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Pergunte uma coisa por vez — respostas específicas vêm de '
                  'perguntas específicas.',
                  style: VibeMatchTextStyles.caption,
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '$length / $kWorkspaceQuestionMaxChars',
                style: VibeMatchTextStyles.caption.copyWith(
                  fontWeight: FontWeight.w700,
                  color: length > kWorkspaceQuestionMaxChars - 60
                      ? VibeMatchColors.scoreGold
                      : VibeMatchColors.textHigh,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: canAsk ? onAsk : null,
              icon: const Icon(Icons.insights_rounded, size: 18),
              label: const Text('Analisar'),
            ),
          ),
          if (!canAsk) ...[
            const SizedBox(height: 10),
            _InlineNotice(
              icon: Icons.info_outline_rounded,
              tone: VibeMatchColors.textLow,
              message: length == 0
                  ? 'Escreva a sua pergunta acima para liberar a análise — '
                      'pelo menos $kWorkspaceQuestionMinChars caracteres.'
                  : missing > 0
                      ? 'Faltam $missing '
                          '${missing == 1 ? 'caractere' : 'caracteres'}. '
                          'Abaixo de $kWorkspaceQuestionMinChars não dá para '
                          'saber o que você quer.'
                      : 'Sua pergunta passou de $kWorkspaceQuestionMaxChars '
                          'caracteres. Corte o contexto — o documento já está '
                          'aqui.',
            ),
          ],
        ],
      ),
    );
  }
}

/// Honest progress while the analysis runs.
///
/// It takes seconds, and a bare spinner for that long reads as a hung screen.
/// This names the phases the request actually goes through, echoes the question
/// back, and shows the elapsed time — so a slow response looks slow rather than
/// broken.
class _AnalysingView extends StatefulWidget {
  const _AnalysingView({required this.question});

  final String question;

  @override
  State<_AnalysingView> createState() => _AnalysingViewState();
}

class _AnalysingViewState extends State<_AnalysingView> {
  static const List<String> _stages = [
    'Lendo o documento inteiro',
    'Procurando o que responde exatamente à sua pergunta',
    'Separando achados, riscos e o que fazer',
    'Cruzando com quem, na plataforma, resolve isso',
  ];

  /// Seconds after which each stage starts. The last has no upper bound — it
  /// stays until the response lands.
  static const List<int> _stageStartsAt = [0, 4, 9, 15];

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
                widget.question.isEmpty
                    ? 'Lendo o seu documento'
                    : widget.question,
                style: VibeMatchTextStyles.sectionTitle,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
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
                '${_elapsed}s — normalmente leva entre 10 e 40 segundos. '
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

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/// The payoff, laid out as a document rather than as a chat bubble: dateline,
/// serif headline, reading-width summary, then the four blocks — achados,
/// riscos, ações, quem resolve.
class _AnalysisReport extends StatelessWidget {
  const _AnalysisReport({required this.analysis});

  final WorkspaceAnalysis analysis;

  @override
  Widget build(BuildContext context) {
    if (analysis.isFailed) {
      return const VibeEmptyState(
        icon: Icons.error_outline_rounded,
        title: 'Esta análise falhou',
        message: 'O documento continua guardado. Refaça a pergunta acima — se '
            'falhar de novo, tente uma pergunta mais estreita.',
      );
    }
    if (analysis.isPending) {
      return const VibeEmptyState(
        icon: Icons.hourglass_top_rounded,
        title: 'Ainda processando',
        message: 'A análise foi aceita e está sendo escrita. Puxe a tela para '
            'baixo daqui a alguns instantes para atualizar.',
      );
    }
    if (!analysis.hasReportBody) {
      return const VibeEmptyState(
        icon: Icons.inbox_rounded,
        title: 'Sem conteúdo nesta resposta',
        message: 'A análise voltou vazia. Refaça a pergunta de forma mais '
            'específica — cite a cláusula, a linha ou o número que te '
            'interessa.',
      );
    }

    final context0 = analysis.context;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                analysis.createdAt == null
                    ? 'ANÁLISE'
                    : formatFullDate(analysis.createdAt!).toUpperCase(),
                style: VibeMatchTextStyles.eyebrow,
              ),
            ),
            _SourceTag(aiGenerated: analysis.aiGenerated),
          ],
        ),
        const SizedBox(height: 14),

        if (analysis.question.isNotEmpty) ...[
          _AskedQuestion(question: analysis.question),
          const SizedBox(height: 18),
        ],

        if (analysis.headline.isNotEmpty) ...[
          Text(analysis.headline, style: VibeMatchTextStyles.display(30)),
          const SizedBox(height: 16),
        ],

        if (analysis.summary.isNotEmpty)
          Text(analysis.summary, style: VibeMatchTextStyles.readingBody),

        // The platform showing it knows who it is talking to. Sits right under
        // the summary because that is where "why should I believe this" lands.
        if (context0 != null && context0.hasAnything) ...[
          const SizedBox(height: 22),
          _ContextStrip(context: context0),
        ],

        if (analysis.findings.isNotEmpty) ...[
          const SizedBox(height: VibeMatchSpacing.sectionGap),
          const VibeSectionHeader(
            eyebrow: 'Achados',
            title: 'O que eu',
            titleAccent: 'encontrei',
            subtitle: 'Cada achado traz o trecho em que ele aparece. Confira '
                'contra o seu documento antes de agir.',
          ),
          const SizedBox(height: 18),
          for (final finding in analysis.findingsBySeverity)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _FindingCard(finding: finding),
            ),
        ],

        if (analysis.risks.isNotEmpty) ...[
          const SizedBox(height: VibeMatchSpacing.sectionGap),
          const VibeSectionHeader(
            eyebrow: 'Riscos',
            title: 'O que pode',
            titleAccent: 'dar errado',
            subtitle: 'Consequências prováveis se nada mudar.',
          ),
          const SizedBox(height: 16),
          for (final risk in analysis.risks)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _RiskRow(text: risk),
            ),
        ],

        if (analysis.actions.isNotEmpty) ...[
          const SizedBox(height: VibeMatchSpacing.sectionGap),
          const VibeSectionHeader(
            eyebrow: 'Ações',
            title: 'Por onde',
            titleAccent: 'começar',
            subtitle: 'Em ordem. A primeira linha é a que destrava as outras.',
          ),
          const SizedBox(height: 18),
          for (var i = 0; i < analysis.actions.length; i++)
            _ActionRow(index: i + 1, text: analysis.actions[i]),
        ],

        if (analysis.matchedProviders.isNotEmpty) ...[
          const SizedBox(height: VibeMatchSpacing.sectionGap),
          _ProvidersBlock(
            providers: analysis.matchedProviders,
            skills: analysis.suggestedSkills,
          ),
        ] else if (analysis.suggestedSkills.isNotEmpty) ...[
          const SizedBox(height: VibeMatchSpacing.sectionGap),
          const VibeSectionHeader(
            eyebrow: 'Briefing de contratação',
            title: 'O que procurar em',
            titleAccent: 'quem você contratar',
            subtitle:
                'Ninguém com este perfil está disponível agora. Use estas '
                'competências como filtro na busca.',
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final skill in analysis.suggestedSkills)
                VibeTag(label: skill),
            ],
          ),
        ],
      ],
    );
  }
}

/// The question, quoted back above the answer. Without it a report read weeks
/// later is an answer to nothing.
class _AskedQuestion extends StatelessWidget {
  const _AskedQuestion({required this.question});

  final String question;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: VibeMatchColors.slate.withOpacity(0.45),
        borderRadius: VibeMatchRadii.buttonRadius,
        border: const Border(
          left: BorderSide(color: VibeMatchColors.neonPrimary, width: 3),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Icon(
              Icons.help_outline_rounded,
              size: 15,
              color: VibeMatchColors.scoreGold,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              question,
              style: VibeMatchTextStyles.body.copyWith(
                color: VibeMatchColors.textHigh,
                fontStyle: FontStyle.italic,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// K-Score, contratos abertos, pilar mais frágil — the three facts that prove
/// the answer came from a platform that already knows this account.
class _ContextStrip extends StatelessWidget {
  const _ContextStrip({required this.context});

  final AnalysisContext context;

  @override
  Widget build(BuildContext buildContext) {
    final items = <(String, String)>[
      if (context.kScore > 0) ('K-Score', '${context.kScore}'),
      if (context.openContracts > 0)
        ('Contratos abertos', '${context.openContracts}'),
      if (context.weakestPillar != null && context.weakestPillar!.isNotEmpty)
        ('Pilar mais frágil', _pillarLabel(context.weakestPillar!)),
    ];
    if (items.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: VibeMatchColors.ink.withOpacity(0.45),
        borderRadius: VibeMatchRadii.cardRadius,
        border: Border.all(color: VibeMatchColors.goldDeep.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.fingerprint_rounded,
                size: 14,
                color: VibeMatchColors.scoreGold,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  'LIDO COM O SEU CONTEXTO',
                  style: VibeMatchTextStyles.caption.copyWith(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.4,
                    color: VibeMatchColors.scoreGold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 26,
            runSpacing: 12,
            children: [
              for (final item in items)
                Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.$2,
                      style: VibeMatchTextStyles.subheading.copyWith(
                        fontSize: 17,
                        color: VibeMatchColors.textHigh,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(item.$1, style: VibeMatchTextStyles.caption),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }

  /// The workspace carries the pillar as a bare wire value; the diagnostic's
  /// own label map is not imported here to keep the two features independent.
  static String _pillarLabel(String pillar) => switch (pillar.toUpperCase()) {
        'VENDAS' => 'Vendas',
        'GESTAO' => 'Gestão',
        'TECNOLOGIA' => 'Tecnologia',
        'FINANCAS' => 'Finanças',
        _ => pillar,
      };
}

Color _severityColor(String severity) => switch (severity.toUpperCase()) {
      'ALTA' => VibeMatchColors.live,
      'MEDIA' => VibeMatchColors.scoreGold,
      _ => VibeMatchColors.textLow,
    };

class _FindingCard extends StatelessWidget {
  const _FindingCard({required this.finding});

  final AnalysisFinding finding;

  @override
  Widget build(BuildContext context) {
    final tone = _severityColor(finding.severity);
    return VibeCard(
      padding: EdgeInsets.zero,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // A severity spine rather than a dot: at a glance the column of
            // findings reads as a heat map down the left edge.
            Container(width: 4, color: tone),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            finding.title.isEmpty ? 'Achado' : finding.title,
                            style: VibeMatchTextStyles.cardTitle,
                          ),
                        ),
                        const SizedBox(width: 10),
                        VibeTag(label: finding.severityLabel, color: tone),
                      ],
                    ),
                    if (finding.detail.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Text(
                        finding.detail,
                        style: VibeMatchTextStyles.readingBody.copyWith(
                          fontSize: 14.5,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RiskRow extends StatelessWidget {
  const _RiskRow({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 3),
          child: Icon(
            Icons.warning_amber_rounded,
            size: 16,
            color: VibeMatchColors.live,
          ),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Text(
            text,
            style: VibeMatchTextStyles.readingBody.copyWith(fontSize: 15),
          ),
        ),
      ],
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({required this.index, required this.text});

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

/// "Quem pode resolver isso" — the block that no general-purpose assistant can
/// produce, so it is given a full section rather than a trailing line.
class _ProvidersBlock extends StatelessWidget {
  const _ProvidersBlock({required this.providers, required this.skills});

  final List<MatchedProvider> providers;
  final List<String> skills;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        VibeSectionHeader(
          eyebrow: 'A diferença',
          title: 'Quem pode',
          titleAccent: 'resolver isso',
          subtitle: '${providers.length} '
              '${providers.length == 1 ? 'profissional' : 'profissionais'} '
              'desta plataforma com as competências que a análise apontou, '
              'com K-Score e valor à vista. Nenhum chatbot termina a resposta '
              'assim.',
        ),
        const SizedBox(height: 18),
        for (final provider in providers)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _ProviderCard(provider: provider),
          ),
        if (skills.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            'Competências que a análise pediu',
            style: VibeMatchTextStyles.caption.copyWith(
              fontWeight: FontWeight.w700,
              color: VibeMatchColors.textHigh,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [for (final skill in skills) VibeTag(label: skill)],
          ),
        ],
      ],
    );
  }
}

class _ProviderCard extends StatelessWidget {
  const _ProviderCard({required this.provider});

  final MatchedProvider provider;

  @override
  Widget build(BuildContext context) {
    final rate = formatMoney(provider.hourlyRate, provider.rateCurrency);
    final initials = _initials(provider.name);

    return VibeCard(
      highlighted: true,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 46,
                height: 46,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: VibeMatchColors.coverGradientFor(
                      provider.userId.isEmpty ? provider.name : provider.userId,
                    ),
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  border: Border.all(
                    color: VibeMatchColors.goldDeep.withOpacity(0.7),
                  ),
                ),
                child: Text(
                  initials,
                  style: VibeMatchTextStyles.subheading.copyWith(
                    color: VibeMatchColors.textHigh,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      provider.name,
                      style: VibeMatchTextStyles.cardTitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (provider.headline.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        provider.headline,
                        style: VibeMatchTextStyles.caption,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 10),
              ScoreBadge(score: provider.kScore, compact: true),
            ],
          ),
          if (provider.skills.isNotEmpty) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final skill in provider.skills.take(5))
                  VibeTag(label: skill, color: VibeMatchColors.textLow),
              ],
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Text(
                  rate == null ? 'Valor sob consulta' : '$rate / hora',
                  style: VibeMatchTextStyles.subheading.copyWith(
                    color: VibeMatchColors.scoreGold,
                  ),
                ),
              ),
              Text(
                'K-Score ${provider.kScore}',
                style: VibeMatchTextStyles.caption,
              ),
            ],
          ),
        ],
      ),
    );
  }

  static String _initials(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) {
      return parts.first.substring(0, 1).toUpperCase();
    }
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
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

class _HistoryTile extends StatelessWidget {
  const _HistoryTile({
    required this.analysis,
    required this.selected,
    required this.onTap,
  });

  final WorkspaceAnalysis analysis;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      onTap: onTap,
      highlighted: selected,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  analysis.createdAt == null
                      ? 'Análise'
                      : formatRelativeDate(analysis.createdAt!),
                  style: VibeMatchTextStyles.caption.copyWith(
                    color: VibeMatchColors.scoreGold,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (analysis.isFailed)
                const VibeTag(
                  label: 'Falhou',
                  color: VibeMatchColors.negative,
                )
              else if (analysis.isPending)
                const VibeTag(label: 'Processando')
              else
                _SourceTag(aiGenerated: analysis.aiGenerated),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            analysis.question.isEmpty ? 'Sem pergunta' : analysis.question,
            style: VibeMatchTextStyles.subheading,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          if (analysis.headline.isNotEmpty) ...[
            const SizedBox(height: 5),
            Text(
              analysis.headline,
              style: VibeMatchTextStyles.body,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (analysis.findings.isNotEmpty ||
              analysis.matchedProviders.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                if (analysis.findings.isNotEmpty) ...[
                  const Icon(
                    Icons.flag_rounded,
                    size: 13,
                    color: VibeMatchColors.textLow,
                  ),
                  const SizedBox(width: 5),
                  Text(
                    '${analysis.findings.length} '
                    '${analysis.findings.length == 1 ? 'achado' : 'achados'}',
                    style: VibeMatchTextStyles.caption,
                  ),
                  const SizedBox(width: 14),
                ],
                if (analysis.matchedProviders.isNotEmpty) ...[
                  const Icon(
                    Icons.groups_2_rounded,
                    size: 13,
                    color: VibeMatchColors.neonPrimary,
                  ),
                  const SizedBox(width: 5),
                  Text(
                    '${analysis.matchedProviders.length} para resolver',
                    style: VibeMatchTextStyles.caption.copyWith(
                      color: VibeMatchColors.neonPrimary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }
}
