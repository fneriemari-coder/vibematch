import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/models/academy_models.dart';
import '../../data/repositories/academy_repository.dart';
import '../widgets/vibe_ui.dart';
import 'vibe_academy_screen.dart';

/// The VIBE Academy catalogue: search, then a responsive grid of programme
/// cards. Modelled on the reference's course listing — cover, hard numbers
/// (rating, modules, students) and a single unmistakable price/continue
/// affordance per card, so a long grid stays scannable.
class CoursesScreen extends StatefulWidget {
  const CoursesScreen({super.key, required this.academyRepository});

  final AcademyRepository academyRepository;

  @override
  State<CoursesScreen> createState() => _CoursesScreenState();
}

class _CoursesScreenState extends State<CoursesScreen> {
  final _searchController = TextEditingController();

  Timer? _debounce;
  bool _loading = true;
  String? _error;
  CoursePage? _page;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.academyRepository.listCourses(
        search: _searchController.text,
      );
      if (!mounted) return;
      setState(() {
        _page = page;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível carregar o catálogo de cursos.',
        );
        _loading = false;
      });
    }
  }

  /// Typing fires a request per keystroke otherwise — 400ms is long enough to
  /// coalesce a word and short enough that the grid still feels live.
  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _load);
  }

  void _openCourse(CourseCard course) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => VibeAcademyScreen(
          courseId: course.id,
          academyRepository: widget.academyRepository,
        ),
      ),
    );
  }

  /// Generates a whole course for the signed-in user.
  ///
  /// `POST /academy/generate-ai-course` existed from the start but nothing in
  /// the app ever called it, so the AI factory was unreachable. Generation
  /// takes a while, so the sheet stays up with an honest "isto leva um
  /// minuto" message instead of a spinner that looks hung.
  Future<void> _generateWithAi() async {
    final topicController = TextEditingController();
    // Owned by this method rather than by the State, so it has to be released
    // here — every open of the dialog used to leak one. `whenComplete` runs
    // after the route is finalised, so nothing is still reading the controller.
    final topic = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: VibeMatchColors.surface,
        title:
            Text('Criar curso com IA', style: VibeMatchTextStyles.subheading),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Diga o tema e a IA escreve o programa completo: escopo, roteiro '
              'de cada módulo e o material de apoio. Deixe em branco para ela '
              'escolher a partir do que está em alta.',
              style: VibeMatchTextStyles.body,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: topicController,
              autofocus: true,
              maxLength: 200,
              style: const TextStyle(color: VibeMatchColors.textHigh),
              decoration: const InputDecoration(
                labelText: 'Tema (opcional)',
                hintText: 'Ex.: precificação para agências',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(topicController.text.trim()),
            child: const Text('Gerar'),
          ),
        ],
      ),
    ).whenComplete(topicController.dispose);
    if (topic == null || !mounted) return;

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        backgroundColor: VibeMatchColors.surface,
        content: Row(
          children: [
            const SizedBox(
              height: 20,
              width: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: VibeMatchColors.neonPrimary,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                'Escrevendo o curso — isto leva cerca de um minuto.',
                style: VibeMatchTextStyles.body,
              ),
            ),
          ],
        ),
      ),
    );

    try {
      final courseId =
          await widget.academyRepository.generateAiCourse(topicHint: topic);
      if (!mounted) return;
      Navigator.of(context).pop(); // dismiss the progress dialog
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => VibeAcademyScreen(
            courseId: courseId,
            academyRepository: widget.academyRepository,
          ),
        ),
      );
      if (mounted) await _load();
    } catch (error) {
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: 'Não foi possível gerar o curso agora.',
            ),
          ),
        ),
      );
    }
  }

  /// 1 column on a phone, 2 on a tablet, 3 on the web build — the card is
  /// designed around a ~330px measure and stretches badly past it.
  int _columnsFor(double width) {
    if (width < 620) return 1;
    if (width < 1000) return 2;
    return 3;
  }

  @override
  Widget build(BuildContext context) {
    final courses = _page?.courses ?? const <CourseCard>[];
    final columns = _columnsFor(MediaQuery.sizeOf(context).width);

    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Academy')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _generateWithAi,
        backgroundColor: VibeMatchColors.neonPrimary,
        foregroundColor: VibeMatchColors.ink,
        icon: const Icon(Icons.auto_awesome_rounded, size: 18),
        label: const Text('Criar com IA'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: VibeMatchColors.neonPrimary,
        backgroundColor: VibeMatchColors.surface,
        child: CustomScrollView(
          // Keeps pull-to-refresh reachable even when the body is a single
          // centred empty state that would not otherwise scroll.
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: VibeContent(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 24),
                    const VibeSectionHeader(
                      eyebrow: 'VIBE Academy',
                      title: 'Programas para',
                      titleAccent: 'quem executa',
                      subtitle:
                          'Formações curtas, conduzidas por quem já fez — '
                          'com os profissionais certos a um toque de distância.',
                    ),
                    const SizedBox(height: 22),
                    TextField(
                      controller: _searchController,
                      onChanged: _onSearchChanged,
                      onSubmitted: (_) => _load(),
                      textInputAction: TextInputAction.search,
                      style: VibeMatchTextStyles.body.copyWith(
                        color: VibeMatchColors.textHigh,
                      ),
                      decoration: const InputDecoration(
                        hintText: 'Buscar por tema, skill ou instrutor',
                        prefixIcon: Icon(
                          Icons.search_rounded,
                          color: VibeMatchColors.textLow,
                          size: 20,
                        ),
                      ),
                    ),
                    if (!_loading && _error == null && courses.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(
                        '${formatCount(_page?.total ?? courses.length)} '
                        'programas disponíveis',
                        style: VibeMatchTextStyles.caption,
                      ),
                    ],
                    const SizedBox(height: 20),
                  ],
                ),
              ),
            ),
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
            else if (courses.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: VibeEmptyState(
                  icon: Icons.school_rounded,
                  title: _searchController.text.trim().isEmpty
                      ? 'Nenhum programa publicado ainda'
                      : 'Nenhum programa para essa busca',
                  message: _searchController.text.trim().isEmpty
                      ? 'Assim que a Academy publicar as primeiras formações, '
                          'elas aparecem aqui.'
                      : 'Tente outro tema, ou limpe a busca para ver o '
                          'catálogo inteiro.',
                  action: _searchController.text.trim().isEmpty
                      ? null
                      : OutlinedButton(
                          onPressed: () {
                            _searchController.clear();
                            _load();
                          },
                          child: const Text('Limpar busca'),
                        ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                  VibeMatchSpacing.gutter,
                  0,
                  VibeMatchSpacing.gutter,
                  VibeMatchSpacing.sectionGap,
                ),
                sliver: SliverGrid(
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: columns,
                    mainAxisSpacing: 16,
                    crossAxisSpacing: 16,
                    // A fixed extent rather than an aspect ratio: the card's
                    // content height is constant, so tying it to the column
                    // width would leave the tall single-column layout empty.
                    mainAxisExtent: 384,
                  ),
                  delegate: SliverChildBuilderDelegate(
                    (context, index) => _CourseCardTile(
                      course: courses[index],
                      onTap: () => _openCourse(courses[index]),
                    ),
                    childCount: courses.length,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _CourseCardTile extends StatelessWidget {
  const _CourseCardTile({required this.course, required this.onTap});

  final CourseCard course;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final price = formatMoney(course.price, course.currency);

    return VibeCard(
      onTap: onTap,
      highlighted: course.enrolled,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          VibeCover(
            seed: course.id,
            imageUrl: course.mediaPreviewUrl,
            height: 150,
            icon: Icons.school_rounded,
            overlay: course.enrolled
                ? Align(
                    alignment: Alignment.topLeft,
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: VibeTag(
                        label: 'Matriculado',
                        filled: true,
                        icon: Icons.check_rounded,
                      ),
                    ),
                  )
                : null,
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    course.title,
                    style: VibeMatchTextStyles.cardTitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 5),
                  Text(
                    course.instructorName.isEmpty
                        ? 'Instrutor a confirmar'
                        : 'com ${course.instructorName}',
                    style: VibeMatchTextStyles.caption,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 14,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (course.rating > 0) VibeRating(rating: course.rating),
                      _MetaLine(
                        icon: Icons.view_module_rounded,
                        label: '${course.moduleCount} '
                            '${course.moduleCount == 1 ? 'módulo' : 'módulos'}',
                      ),
                      _MetaLine(
                        icon: Icons.groups_rounded,
                        label: '${formatCount(course.studentCount)} '
                            '${course.studentCount == 1 ? 'aluno' : 'alunos'}',
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (course.skillsTaught.isNotEmpty)
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: course.skillsTaught
                          .take(3)
                          .map((skill) => VibeTag(label: skill))
                          .toList(),
                    ),
                  const Spacer(),
                  const Divider(color: VibeMatchColors.border, height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: course.enrolled
                            ? Text(
                                'Continuar',
                                style: VibeMatchTextStyles.subheading.copyWith(
                                  color: VibeMatchColors.neonPrimary,
                                ),
                              )
                            : Text(
                                price ?? 'Gratuito',
                                style: VibeMatchTextStyles.subheading.copyWith(
                                  fontSize: 17,
                                ),
                              ),
                      ),
                      Icon(
                        course.enrolled
                            ? Icons.play_circle_fill_rounded
                            : Icons.arrow_forward_rounded,
                        size: course.enrolled ? 24 : 18,
                        color: VibeMatchColors.neonPrimary,
                      ),
                    ],
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

/// Icon + caption pair used for the small hard numbers on a card.
class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: VibeMatchColors.textLow),
        const SizedBox(width: 5),
        Text(label, style: VibeMatchTextStyles.caption),
      ],
    );
  }
}
