import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/academy_models.dart';
import '../../data/repositories/academy_repository.dart';
import '../widgets/vibe_glass_card.dart';

/// Frictionless landing screen for the AI-retention push deep link
/// ("Seu sistema apresentou um erro de [TAG]?..."): lesson video player,
/// PDF material download, and the recommended-providers upsell — all for
/// one `courseId`, loaded with no extra taps after the notification tap.
class VibeAcademyScreen extends StatefulWidget {
  const VibeAcademyScreen({super.key, required this.courseId, required this.academyRepository});

  final String courseId;
  final AcademyRepository academyRepository;

  @override
  State<VibeAcademyScreen> createState() => _VibeAcademyScreenState();
}

class _VibeAcademyScreenState extends State<VibeAcademyScreen> {
  late Future<CourseDetail> _courseFuture;
  late Future<CourseConnections> _connectionsFuture;

  @override
  void initState() {
    super.initState();
    _courseFuture = widget.academyRepository.getCourseDetail(widget.courseId);
    _connectionsFuture = widget.academyRepository.getCourseConnections(widget.courseId);
  }

  Future<void> _openMaterial(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível abrir o material de apoio.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('VIBE Academy'),
      ),
      body: FutureBuilder<CourseDetail>(
        future: _courseFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator(color: VibeMatchColors.neonPrimary));
          }
          if (snapshot.hasError || !snapshot.hasData) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text('Não foi possível carregar este curso.', style: VibeMatchTextStyles.body),
              ),
            );
          }

          final course = snapshot.data!;
          final firstModule = course.modules.isNotEmpty ? course.modules.first : null;

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (firstModule != null) _LessonPlayer(module: firstModule),
              const SizedBox(height: 20),
              Text(course.title, style: VibeMatchTextStyles.heading),
              const SizedBox(height: 6),
              Text('por ${course.instructorName}', style: VibeMatchTextStyles.body),
              const SizedBox(height: 12),
              Text(course.description, style: VibeMatchTextStyles.body),
              const SizedBox(height: 20),
              if (course.materialDownloadUrl != null)
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => _openMaterial(course.materialDownloadUrl!),
                    icon: const Icon(Icons.picture_as_pdf_outlined),
                    label: const Text('Baixar Material de Apoio (PDF)'),
                  ),
                ),
              if (course.modules.length > 1) ...[
                const SizedBox(height: 24),
                Text('Módulos do curso', style: VibeMatchTextStyles.subheading),
                const SizedBox(height: 8),
                ...course.modules.map(
                  (m) => Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text('${m.orderIndex + 1}. ${m.title}', style: VibeMatchTextStyles.body),
                  ),
                ),
              ],
              const SizedBox(height: 28),
              Text('Profissionais recomendados', style: VibeMatchTextStyles.subheading),
              const SizedBox(height: 12),
              _RecommendedProvidersSection(future: _connectionsFuture),
            ],
          );
        },
      ),
    );
  }
}

/// Plays the first module's lesson video. `videoUrl` may be a placeholder
/// from the not-yet-real generateLessonVideo() pipeline, so any load error
/// falls back to a static "video unavailable" panel instead of crashing.
class _LessonPlayer extends StatefulWidget {
  const _LessonPlayer({required this.module});

  final CourseModuleItem module;

  @override
  State<_LessonPlayer> createState() => _LessonPlayerState();
}

class _LessonPlayerState extends State<_LessonPlayer> {
  VideoPlayerController? _controller;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    final url = widget.module.videoUrl;
    if (url == null) {
      _failed = true;
      return;
    }
    final uri = Uri.tryParse(url);
    if (uri == null) {
      _failed = true;
      return;
    }
    _controller = VideoPlayerController.networkUrl(uri)
      ..initialize().then((_) {
        if (mounted) setState(() {});
      }).catchError((_) {
        if (mounted) setState(() => _failed = true);
      });
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: VibeMatchRadii.cardRadius,
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: _failed || _controller == null
            ? const ColoredBox(
                color: VibeMatchColors.surface,
                child: Center(
                  child: Icon(Icons.play_circle_outline, size: 56, color: VibeMatchColors.textLow),
                ),
              )
            : _controller!.value.isInitialized
                ? Stack(
                    alignment: Alignment.center,
                    children: [
                      VideoPlayer(_controller!),
                      IconButton(
                        iconSize: 56,
                        icon: Icon(
                          _controller!.value.isPlaying ? Icons.pause_circle : Icons.play_circle,
                          color: Colors.white,
                        ),
                        onPressed: () => setState(() {
                          _controller!.value.isPlaying ? _controller!.pause() : _controller!.play();
                        }),
                      ),
                    ],
                  )
                : const ColoredBox(
                    color: VibeMatchColors.surface,
                    child: Center(child: CircularProgressIndicator(color: VibeMatchColors.neonPrimary)),
                  ),
      ),
    );
  }
}

class _RecommendedProvidersSection extends StatelessWidget {
  const _RecommendedProvidersSection({required this.future});

  final Future<CourseConnections> future;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<CourseConnections>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Center(child: CircularProgressIndicator(color: VibeMatchColors.neonPrimary)),
          );
        }
        final profiles = snapshot.data?.profiles ?? const [];
        if (profiles.isEmpty) {
          return Text('Nenhum profissional recomendado ainda.', style: VibeMatchTextStyles.body);
        }
        return Column(
          children: profiles
              .map(
                (p) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: VibeGlassCard(
                    child: Row(
                      children: [
                        const CircleAvatar(
                          backgroundColor: VibeMatchColors.background,
                          child: Icon(Icons.person, color: VibeMatchColors.neonPrimary),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(p.name, style: VibeMatchTextStyles.subheading),
                              Text(
                                p.skills.join(' • '),
                                style: VibeMatchTextStyles.body,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        if (p.hourlyRate != null)
                          Text('${p.rateCurrency} ${p.hourlyRate}/h', style: VibeMatchTextStyles.scoreDigits),
                      ],
                    ),
                  ),
                ),
              )
              .toList(),
        );
      },
    );
  }
}
