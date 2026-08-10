/// Models for GET /academy/courses/:courseId and GET /academy/course-connections/:courseId
/// — the two endpoints VibeAcademyScreen renders after a retention-push deep link.

class CourseModuleItem {
  const CourseModuleItem({
    required this.id,
    required this.orderIndex,
    required this.title,
    required this.videoUrl,
  });

  final String id;
  final int orderIndex;
  final String title;
  // Set once ai-factory.service.ts's generateLessonVideo() "renders" this
  // lesson — that step is currently a placeholder, so this URL may be null
  // or point at a non-playable stub. The player below must fail gracefully.
  final String? videoUrl;

  factory CourseModuleItem.fromJson(Map<String, dynamic> json) =>
      CourseModuleItem(
        id: json['id'] as String,
        orderIndex: json['orderIndex'] as int? ?? 0,
        title: json['title'] as String? ?? '',
        videoUrl: json['videoUrl'] as String?,
      );
}

class CourseDetail {
  const CourseDetail({
    required this.id,
    required this.title,
    required this.description,
    required this.instructorName,
    required this.materialDownloadUrl,
    required this.modules,
  });

  final String id;
  final String title;
  final String description;
  final String instructorName;
  final String? materialDownloadUrl;
  final List<CourseModuleItem> modules;

  factory CourseDetail.fromJson(Map<String, dynamic> json) => CourseDetail(
        id: json['id'] as String,
        title: json['title'] as String? ?? '',
        description: json['description'] as String? ?? '',
        instructorName: (json['instructor']
                as Map<String, dynamic>?)?['profile']?['name'] as String? ??
            'Instrutor',
        materialDownloadUrl: json['materialDownloadUrl'] as String?,
        modules: (json['modules'] as List? ?? [])
            .map((e) => CourseModuleItem.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

/// Recommended provider — feeds the "profissionais recomendados" section
/// below the lesson player (course.skillsTaught matched against providers'
/// UserProfile.skills).
class RecommendedProvider {
  const RecommendedProvider({
    required this.userId,
    required this.name,
    required this.bio,
    required this.skills,
    required this.averageRating,
    required this.hourlyRate,
    required this.rateCurrency,
  });

  final String userId;
  final String name;
  final String bio;
  final List<String> skills;
  final double averageRating;
  final String? hourlyRate;
  final String rateCurrency;

  factory RecommendedProvider.fromJson(Map<String, dynamic> json) =>
      RecommendedProvider(
        userId: json['userId'] as String,
        name: json['name'] as String? ?? '',
        bio: json['bio'] as String? ?? '',
        skills: (json['skills'] as List?)?.cast<String>() ?? const [],
        averageRating: double.tryParse('${json['averageRating'] ?? 0}') ?? 0,
        hourlyRate: json['hourlyRate']?.toString(),
        rateCurrency: json['rateCurrency'] as String? ?? 'USD',
      );
}

class CourseConnections {
  const CourseConnections({required this.skillsTaught, required this.profiles});

  final List<String> skillsTaught;
  final List<RecommendedProvider> profiles;

  factory CourseConnections.fromJson(Map<String, dynamic> json) =>
      CourseConnections(
        skillsTaught:
            (json['skillsTaught'] as List?)?.cast<String>() ?? const [],
        profiles: (json['profiles'] as List? ?? [])
            .map((e) => RecommendedProvider.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
