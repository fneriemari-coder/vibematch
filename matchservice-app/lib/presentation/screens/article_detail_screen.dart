import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/models/content_models.dart';
import '../../data/repositories/content_repository.dart';
import '../widgets/article_tile.dart';
import '../widgets/vibe_ui.dart';

/// A single article: full-bleed cover with the title over it, a dateline, the
/// markdown body set at reading measure, and a rail of related pieces.
class ArticleDetailScreen extends StatefulWidget {
  const ArticleDetailScreen({
    super.key,
    required this.slug,
    required this.contentRepository,
  });

  final String slug;
  final ContentRepository contentRepository;

  @override
  State<ArticleDetailScreen> createState() => _ArticleDetailScreenState();
}

class _ArticleDetailScreenState extends State<ArticleDetailScreen> {
  late Future<ArticleDetail> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.contentRepository.getArticle(widget.slug);
  }

  void _reload() {
    setState(() {
      _future = widget.contentRepository.getArticle(widget.slug);
    });
  }

  void _openRelated(ArticleCard related) {
    if (related.slug.isEmpty) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => ArticleDetailScreen(
          slug: related.slug,
          contentRepository: widget.contentRepository,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      // The cover runs under the app bar so the header reads as one image
      // rather than a photo pushed below a navy strip.
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text(''),
      ),
      body: FutureBuilder<ArticleDetail>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(
              child: CircularProgressIndicator(
                color: VibeMatchColors.neonPrimary,
              ),
            );
          }
          if (snapshot.hasError || !snapshot.hasData) {
            return VibeErrorState(
              message: snapshot.error == null
                  ? 'Este artigo não está disponível.'
                  : describeApiError(
                      snapshot.error!,
                      fallback: 'Não foi possível carregar este artigo.',
                    ),
              onRetry: _reload,
            );
          }

          final detail = snapshot.data!;
          final article = detail.article;
          final width = MediaQuery.sizeOf(context).width;

          return ListView(
            padding: EdgeInsets.zero,
            children: [
              VibeCover(
                seed: article.slug.isEmpty ? widget.slug : article.slug,
                imageUrl: article.coverImageUrl,
                height: 240,
                icon: Icons.article_rounded,
                overlay: Align(
                  alignment: Alignment.bottomLeft,
                  child: VibeContent(
                    maxWidth: 720,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 20),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              if (article.category.isNotEmpty)
                                VibeTag(label: article.categoryLabel),
                              if (article.aiGenerated) ...[
                                const SizedBox(width: 8),
                                VibeTag(
                                  label: 'IA',
                                  filled: true,
                                  icon: Icons.auto_awesome_rounded,
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 12),
                          Text(
                            article.title,
                            style: VibeMatchTextStyles.display(
                              width < 620 ? 27 : 36,
                            ),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 22),
              VibeContent(
                maxWidth: 720,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _ArticleMeta(article: article),
                    const Divider(color: VibeMatchColors.border, height: 32),
                    if (article.excerpt.isNotEmpty) ...[
                      Text(
                        article.excerpt,
                        style: VibeMatchTextStyles.readingBody.copyWith(
                          fontSize: 18,
                          color: VibeMatchColors.textHigh,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 22),
                    ],
                    if (detail.body.trim().isEmpty)
                      Text(
                        'Este artigo ainda não tem corpo publicado.',
                        style: VibeMatchTextStyles.body,
                      )
                    else
                      ...buildMarkdownBlocks(detail.body),
                  ],
                ),
              ),
              if (detail.related.isNotEmpty) ...[
                const SizedBox(height: VibeMatchSpacing.sectionGap),
                VibeContent(
                  child: const VibeSectionHeader(
                    eyebrow: 'Continue lendo',
                    title: 'Leia',
                    titleAccent: 'também',
                  ),
                ),
                const SizedBox(height: 18),
                VibeCardRail(
                  cardWidth: 250,
                  height: 320,
                  itemCount: detail.related.length,
                  itemBuilder: (context, index) => ArticleTile(
                    article: detail.related[index],
                    coverHeight: 130,
                    onTap: () => _openRelated(detail.related[index]),
                  ),
                ),
              ],
              const SizedBox(height: VibeMatchSpacing.sectionGap),
            ],
          );
        },
      ),
    );
  }
}

class _ArticleMeta extends StatelessWidget {
  const _ArticleMeta({required this.article});

  final ArticleCard article;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 16,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
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
          style: VibeMatchTextStyles.caption,
        ),
        if (article.viewCount > 0)
          Text(
            '${formatCount(article.viewCount)} '
            '${article.viewCount == 1 ? 'leitura' : 'leituras'}',
            style: VibeMatchTextStyles.caption,
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Minimal markdown
// ---------------------------------------------------------------------------

/// Renders the subset of markdown the article pipeline actually emits:
/// `##`/`###` headings, `-` bullets, `1.` numbered items, `**bold**` runs and
/// blank-line paragraph breaks.
///
/// This is deliberately hand-rolled rather than pulling in a markdown package:
/// the app has no markdown dependency today, and adding one to render five
/// constructs would be a heavier change than the constructs themselves.
/// Anything it does not recognise falls through as plain paragraph text, so an
/// unsupported construct degrades to readable prose instead of disappearing.
List<Widget> buildMarkdownBlocks(String source) {
  final widgets = <Widget>[];
  final paragraph = <String>[];

  void flushParagraph() {
    if (paragraph.isEmpty) return;
    final text = paragraph.join(' ');
    paragraph.clear();
    widgets.add(
      Padding(
        padding: const EdgeInsets.only(bottom: 18),
        child: Text.rich(
          TextSpan(
            style: VibeMatchTextStyles.readingBody,
            children: _inlineSpans(text, VibeMatchTextStyles.readingBody),
          ),
        ),
      ),
    );
  }

  void addHeading(String text, double size, double topGap) {
    widgets.add(
      Padding(
        padding: EdgeInsets.only(top: topGap, bottom: 12),
        child: Text(text, style: VibeMatchTextStyles.display(size)),
      ),
    );
  }

  void addListItem(String marker, String text) {
    widgets.add(
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 26,
              child: Text(
                marker,
                style: VibeMatchTextStyles.readingBody.copyWith(
                  color: VibeMatchColors.neonPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Expanded(
              child: Text.rich(
                TextSpan(
                  style: VibeMatchTextStyles.readingBody,
                  children: _inlineSpans(text, VibeMatchTextStyles.readingBody),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  final numbered = RegExp(r'^(\d+)[.)]\s+(.*)$');

  for (final rawLine in source.replaceAll('\r\n', '\n').split('\n')) {
    final line = rawLine.trim();

    if (line.isEmpty) {
      flushParagraph();
      continue;
    }
    if (line.startsWith('### ')) {
      flushParagraph();
      addHeading(line.substring(4).trim(), 19, widgets.isEmpty ? 0 : 14);
      continue;
    }
    if (line.startsWith('## ')) {
      flushParagraph();
      addHeading(line.substring(3).trim(), 24, widgets.isEmpty ? 0 : 18);
      continue;
    }
    if (line.startsWith('# ')) {
      flushParagraph();
      addHeading(line.substring(2).trim(), 28, widgets.isEmpty ? 0 : 18);
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushParagraph();
      addListItem('—', line.substring(2).trim());
      continue;
    }
    final match = numbered.firstMatch(line);
    if (match != null) {
      flushParagraph();
      addListItem('${match.group(1)}.', match.group(2)!.trim());
      continue;
    }
    paragraph.add(line);
  }
  flushParagraph();

  return widgets;
}

/// Splits `**bold**` runs out of a line of body text.
List<InlineSpan> _inlineSpans(String text, TextStyle base) {
  final spans = <InlineSpan>[];
  final pattern = RegExp(r'\*\*(.+?)\*\*');
  var cursor = 0;

  for (final match in pattern.allMatches(text)) {
    if (match.start > cursor) {
      spans.add(TextSpan(text: text.substring(cursor, match.start)));
    }
    spans.add(
      TextSpan(
        text: match.group(1),
        style: base.copyWith(
          fontWeight: FontWeight.w700,
          color: VibeMatchColors.textHigh,
        ),
      ),
    );
    cursor = match.end;
  }
  if (cursor < text.length) {
    spans.add(TextSpan(text: text.substring(cursor)));
  }
  return spans;
}
