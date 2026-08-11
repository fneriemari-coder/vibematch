import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/models/content_models.dart';
import '../../data/repositories/content_repository.dart';
import '../widgets/article_tile.dart';
import '../widgets/vibe_ui.dart';
import 'article_detail_screen.dart';

/// The editorial hub: category filters, one lead piece rendered large, and a
/// responsive grid of everything else. The floating action opens the compose
/// sheet, which is the only place in the app where a member can publish —
/// either writing it themselves or handing the topic to the AI factory.
class ContentScreen extends StatefulWidget {
  const ContentScreen({super.key, required this.contentRepository});

  final ContentRepository contentRepository;

  @override
  State<ContentScreen> createState() => _ContentScreenState();
}

class _ContentScreenState extends State<ContentScreen> {
  bool _loading = true;
  String? _error;
  ArticlePage? _page;

  /// Null means "Todos". Kept separate from the page so the selected chip
  /// survives a failed reload.
  String? _category;

  /// Captured from an unfiltered response. Filtering narrows the server's
  /// `categories` to whatever matched, which would otherwise make the rest of
  /// the filter row vanish the moment you use it.
  List<String> _categories = const [];

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
      final page = await widget.contentRepository.listArticles(
        category: _category,
      );
      if (!mounted) return;
      setState(() {
        _page = page;
        if (_category == null || _categories.isEmpty) {
          _categories = page.categories;
        }
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível carregar os artigos.',
        );
        _loading = false;
      });
    }
  }

  void _selectCategory(String? category) {
    if (_category == category) return;
    setState(() => _category = category);
    _load();
  }

  Future<void> _openArticle(ArticleCard article) async {
    if (article.slug.isEmpty) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ArticleDetailScreen(
          slug: article.slug,
          contentRepository: widget.contentRepository,
        ),
      ),
    );
  }

  Future<void> _openComposer() async {
    final created = await showModalBottomSheet<ArticleCard>(
      context: context,
      backgroundColor: VibeMatchColors.surface,
      isScrollControlled: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(VibeMatchRadii.card),
        ),
      ),
      builder: (_) => _ComposeSheet(repository: widget.contentRepository),
    );
    if (created == null || !mounted) return;
    await _openArticle(created);
    if (!mounted) return;
    // The new piece belongs in the list behind the detail page.
    await _load();
  }

  int _columnsFor(double width) {
    if (width < 620) return 1;
    if (width < 1000) return 2;
    return 3;
  }

  @override
  Widget build(BuildContext context) {
    final articles = _page?.articles ?? const <ArticleCard>[];
    final lead = articles.isEmpty ? null : articles.first;
    final rest =
        articles.length > 1 ? articles.sublist(1) : const <ArticleCard>[];
    final columns = _columnsFor(MediaQuery.sizeOf(context).width);

    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Conteúdo')),
      floatingActionButton: FloatingActionButton(
        onPressed: _openComposer,
        tooltip: 'Publicar um artigo',
        child: const Icon(Icons.edit_rounded),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: VibeMatchColors.neonPrimary,
        backgroundColor: VibeMatchColors.surface,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: VibeContent(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: const [
                    SizedBox(height: 24),
                    VibeSectionHeader(
                      eyebrow: 'Editorial',
                      title: 'O que move',
                      titleAccent: 'quem cresce',
                      subtitle:
                          'Análises curtas de gestão, vendas e estratégia — '
                          'escritas por quem opera, não por quem observa.',
                    ),
                    SizedBox(height: 20),
                  ],
                ),
              ),
            ),
            if (_categories.isNotEmpty)
              SliverToBoxAdapter(
                child: _CategoryFilterRow(
                  categories: _categories,
                  selected: _category,
                  onSelected: _selectCategory,
                ),
              ),
            const SliverToBoxAdapter(child: SizedBox(height: 22)),
            if (_loading)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: CircularProgressIndicator(
                    color: VibeMatchColors.neonPrimary,
                  ),
                ),
              )
            else if (_error != null)
              SliverFillRemaining(
                hasScrollBody: false,
                child: VibeErrorState(message: _error!, onRetry: _load),
              )
            else if (lead == null)
              SliverFillRemaining(
                hasScrollBody: false,
                child: VibeEmptyState(
                  icon: Icons.article_rounded,
                  title: _category == null
                      ? 'Nada publicado ainda'
                      : 'Nada em ${contentCategoryLabel(_category!)}',
                  message: _category == null
                      ? 'Seja o primeiro a publicar — escreva você mesmo ou '
                          'peça um rascunho à IA.'
                      : 'Escolha outra categoria, ou publique o primeiro '
                          'artigo desta.',
                  action: ElevatedButton(
                    onPressed: _openComposer,
                    child: const Text('Publicar artigo'),
                  ),
                ),
              )
            else ...[
              SliverToBoxAdapter(
                child: VibeContent(
                  child: _LeadArticle(
                    article: lead,
                    onTap: () => _openArticle(lead),
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 26)),
              if (rest.isNotEmpty)
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    VibeMatchSpacing.gutter,
                    0,
                    VibeMatchSpacing.gutter,
                    VibeMatchSpacing.sectionGap + 56,
                  ),
                  sliver: SliverGrid(
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      mainAxisSpacing: 16,
                      crossAxisSpacing: 16,
                      mainAxisExtent: 360,
                    ),
                    delegate: SliverChildBuilderDelegate(
                      (context, index) => ArticleTile(
                        article: rest[index],
                        onTap: () => _openArticle(rest[index]),
                      ),
                      childCount: rest.length,
                    ),
                  ),
                )
              else
                const SliverToBoxAdapter(
                  child: SizedBox(height: VibeMatchSpacing.sectionGap),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Horizontal filter row. "Todos" is always first so clearing a filter is one
/// tap away rather than a guess.
class _CategoryFilterRow extends StatelessWidget {
  const _CategoryFilterRow({
    required this.categories,
    required this.selected,
    required this.onSelected,
  });

  final List<String> categories;
  final String? selected;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: VibeMatchSpacing.gutter,
        ),
        itemCount: categories.length + 1,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          if (index == 0) {
            return _CategoryChip(
              label: 'Todos',
              selected: selected == null,
              onTap: () => onSelected(null),
            );
          }
          final category = categories[index - 1];
          return _CategoryChip(
            label: contentCategoryLabel(category),
            selected: selected == category,
            onTap: () => onSelected(category),
          );
        },
      ),
    );
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? VibeMatchColors.neonPrimary : VibeMatchColors.surface,
      borderRadius: VibeMatchRadii.pillRadius,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            borderRadius: VibeMatchRadii.pillRadius,
            border: Border.all(
              color: selected
                  ? VibeMatchColors.neonPrimary
                  : VibeMatchColors.border,
            ),
          ),
          child: Text(
            label,
            style: VibeMatchTextStyles.caption.copyWith(
              fontWeight: FontWeight.w700,
              color: selected ? VibeMatchColors.ink : VibeMatchColors.textHigh,
            ),
          ),
        ),
      ),
    );
  }
}

/// The newest piece, rendered at roughly twice the weight of a grid card —
/// an editorial page needs one thing the eye lands on first.
class _LeadArticle extends StatelessWidget {
  const _LeadArticle({required this.article, required this.onTap});

  final ArticleCard article;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;

    return VibeCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          VibeCover(
            seed: article.slug,
            imageUrl: article.coverImageUrl,
            height: width < 620 ? 200 : 280,
            icon: Icons.article_rounded,
            overlay: Align(
              alignment: Alignment.topLeft,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    VibeTag(label: 'Em destaque', filled: true),
                    if (article.aiGenerated) ...[
                      const SizedBox(width: 8),
                      VibeTag(
                        label: 'IA',
                        icon: Icons.auto_awesome_rounded,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(22, 20, 22, 22),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (article.category.isNotEmpty) ...[
                  VibeTag(label: article.categoryLabel),
                  const SizedBox(height: 12),
                ],
                Text(
                  article.title,
                  style: VibeMatchTextStyles.display(width < 620 ? 25 : 32),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
                if (article.excerpt.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    article.excerpt,
                    style: VibeMatchTextStyles.body.copyWith(fontSize: 15),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                const SizedBox(height: 16),
                Wrap(
                  spacing: 14,
                  runSpacing: 6,
                  children: [
                    if (article.authorName.isNotEmpty)
                      Text(
                        'por ${article.authorName}',
                        style: VibeMatchTextStyles.caption.copyWith(
                          color: VibeMatchColors.textHigh,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    if (article.publishedAt != null)
                      Text(
                        formatFullDate(article.publishedAt!),
                        style: VibeMatchTextStyles.caption,
                      ),
                    Text(
                      '${article.readMinutes} min de leitura',
                      style: VibeMatchTextStyles.caption.copyWith(
                        color: VibeMatchColors.scoreGold,
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

// ---------------------------------------------------------------------------
// Compose sheet
// ---------------------------------------------------------------------------

enum _ComposeMode { write, generate }

/// Both ways to publish, in one sheet: the choice between writing it and
/// generating it is a mode toggle rather than a second screen, because it is
/// the same decision made at the same moment.
class _ComposeSheet extends StatefulWidget {
  const _ComposeSheet({required this.repository});

  final ContentRepository repository;

  @override
  State<_ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<_ComposeSheet> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _excerpt = TextEditingController();
  final _body = TextEditingController();
  final _coverImageUrl = TextEditingController();
  final _topic = TextEditingController();

  _ComposeMode _mode = _ComposeMode.write;
  String _category = contentCategoryLabels.keys.first;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _excerpt.dispose();
    _body.dispose();
    _coverImageUrl.dispose();
    _topic.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final article = _mode == _ComposeMode.write
          ? await widget.repository.createArticle(
              title: _title.text.trim(),
              excerpt: _excerpt.text.trim(),
              body: _body.text.trim(),
              category: _category,
              coverImageUrl: _coverImageUrl.text.trim(),
            )
          : await widget.repository.generateArticle(
              topic: _topic.text.trim(),
              category: _category,
            );
      if (!mounted) return;
      if (article.slug.isEmpty) {
        setState(() {
          _submitting = false;
          _error = 'O artigo foi criado, mas o servidor não devolveu o link '
              'dele. Atualize a lista para encontrá-lo.';
        });
        return;
      }
      Navigator.of(context).pop(article);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = describeApiError(
          error,
          fallback: _mode == _ComposeMode.write
              ? 'Não foi possível publicar seu artigo.'
              : 'Não foi possível gerar o artigo agora.',
        );
      });
    }
  }

  String? _required(String? value, String message) {
    if (value == null || value.trim().isEmpty) return message;
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final writing = _mode == _ComposeMode.write;

    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.88,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(22, 22, 22, 26),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const VibeSectionHeader(
                    eyebrow: 'Publicar',
                    title: 'Divida o que',
                    titleAccent: 'você aprendeu',
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: _ModeButton(
                          label: 'Escrever eu mesmo',
                          icon: Icons.edit_note_rounded,
                          selected: writing,
                          onTap: _submitting
                              ? null
                              : () => setState(
                                    () => _mode = _ComposeMode.write,
                                  ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _ModeButton(
                          label: 'Gerar com IA',
                          icon: Icons.auto_awesome_rounded,
                          selected: !writing,
                          onTap: _submitting
                              ? null
                              : () => setState(
                                    () => _mode = _ComposeMode.generate,
                                  ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  if (writing) ...[
                    _SheetField(
                      controller: _title,
                      label: 'Título',
                      validator: (v) => _required(v, 'Dê um título ao artigo.'),
                    ),
                    _SheetField(
                      controller: _excerpt,
                      label: 'Resumo',
                      maxLines: 2,
                      validator: (v) => _required(
                        v,
                        'Escreva um resumo de uma ou duas linhas.',
                      ),
                    ),
                    _SheetField(
                      controller: _body,
                      label: 'Texto (markdown)',
                      maxLines: 8,
                      validator: (v) => _required(v, 'O texto está vazio.'),
                    ),
                    _SheetField(
                      controller: _coverImageUrl,
                      label: 'URL da capa (opcional)',
                    ),
                  ] else ...[
                    _SheetField(
                      controller: _topic,
                      label: 'Sobre o que a IA deve escrever',
                      maxLines: 3,
                      validator: (v) => _required(
                        v,
                        'Descreva o tema para a IA escrever.',
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(
                        'A IA escreve o rascunho completo e o publica no seu '
                        'nome, marcado como gerado por IA.',
                        style: VibeMatchTextStyles.caption,
                      ),
                    ),
                  ],
                  DropdownButtonFormField<String>(
                    value: _category,
                    dropdownColor: VibeMatchColors.surface,
                    style: VibeMatchTextStyles.body.copyWith(
                      color: VibeMatchColors.textHigh,
                    ),
                    decoration: const InputDecoration(labelText: 'Categoria'),
                    items: contentCategoryLabels.entries
                        .map(
                          (entry) => DropdownMenuItem<String>(
                            value: entry.key,
                            child: Text(entry.value),
                          ),
                        )
                        .toList(),
                    onChanged: _submitting
                        ? null
                        : (value) {
                            if (value != null) {
                              setState(() => _category = value);
                            }
                          },
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    Text(
                      _error!,
                      style: VibeMatchTextStyles.caption.copyWith(
                        color: VibeMatchColors.negative,
                      ),
                    ),
                  ],
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _submitting ? null : _submit,
                      child: _submitting
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(writing ? 'Publicar' : 'Gerar artigo'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ModeButton extends StatelessWidget {
  const _ModeButton({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final tone =
        selected ? VibeMatchColors.neonPrimary : VibeMatchColors.textLow;
    return Material(
      color: selected
          ? VibeMatchColors.neonPrimary.withOpacity(0.12)
          : VibeMatchColors.background,
      borderRadius: VibeMatchRadii.buttonRadius,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: VibeMatchRadii.buttonRadius,
            border: Border.all(
              color: selected
                  ? VibeMatchColors.neonPrimary
                  : VibeMatchColors.border,
            ),
          ),
          child: Column(
            children: [
              Icon(icon, size: 20, color: tone),
              const SizedBox(height: 8),
              Text(
                label,
                textAlign: TextAlign.center,
                style: VibeMatchTextStyles.caption.copyWith(
                  color: selected
                      ? VibeMatchColors.textHigh
                      : VibeMatchColors.textLow,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SheetField extends StatelessWidget {
  const _SheetField({
    required this.controller,
    required this.label,
    this.maxLines = 1,
    this.validator,
  });

  final TextEditingController controller;
  final String label;
  final int maxLines;
  final FormFieldValidator<String>? validator;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: TextFormField(
        controller: controller,
        maxLines: maxLines,
        validator: validator,
        style: VibeMatchTextStyles.body.copyWith(
          color: VibeMatchColors.textHigh,
        ),
        decoration: InputDecoration(
          labelText: label,
          alignLabelWithHint: maxLines > 1,
        ),
      ),
    );
  }
}
