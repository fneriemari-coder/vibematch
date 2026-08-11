import 'mentor_models.dart';

/// Models for GET /academy/courses/:courseId and GET /academy/course-connections/:courseId
/// — the two endpoints VibeAcademyScreen renders after a retention-push deep link —
/// plus the two paginated catalogue endpoints behind CoursesScreen and MentorsScreen.

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

/// A course as it appears in the catalogue grid — deliberately separate from
/// [CourseDetail], which carries the modules and material URL that only the
/// player screen needs.
class CourseCard {
  const CourseCard({
    required this.id,
    required this.title,
    required this.description,
    required this.price,
    required this.currency,
    required this.rating,
    required this.mediaPreviewUrl,
    required this.skillsTaught,
    required this.instructorName,
    required this.moduleCount,
    required this.studentCount,
    required this.enrolled,
  });

  final String id;
  final String title;
  final String description;

  /// Prisma Decimal — string or number on the wire, so it is carried as a
  /// string and formatted at the edge (see `formatMoney`).
  final String? price;
  final String currency;
  final double rating;
  final String? mediaPreviewUrl;
  final List<String> skillsTaught;
  final String instructorName;
  final int moduleCount;
  final int studentCount;

  /// True once the person owns the course — the price is replaced by a
  /// "Continuar" affordance rather than asking them to buy it twice.
  final bool enrolled;

  factory CourseCard.fromJson(Map<String, dynamic> json) => CourseCard(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        description: json['description'] as String? ?? '',
        price: json['price']?.toString(),
        currency: json['currency'] as String? ?? 'BRL',
        rating: double.tryParse('${json['rating'] ?? 0}') ?? 0,
        mediaPreviewUrl: json['mediaPreviewUrl'] as String?,
        skillsTaught:
            (json['skillsTaught'] as List?)?.cast<String>() ?? const [],
        instructorName: json['instructorName'] as String? ?? '',
        moduleCount: int.tryParse('${json['moduleCount'] ?? 0}') ?? 0,
        studentCount: int.tryParse('${json['studentCount'] ?? 0}') ?? 0,
        enrolled: json['enrolled'] as bool? ?? false,
      );
}

class CoursePage {
  const CoursePage({
    required this.courses,
    required this.total,
    required this.limit,
    required this.offset,
  });

  final List<CourseCard> courses;
  final int total;
  final int limit;
  final int offset;

  factory CoursePage.fromJson(Map<String, dynamic> json) => CoursePage(
        courses: (json['courses'] as List? ?? const [])
            .map((e) => CourseCard.fromJson(e as Map<String, dynamic>))
            .toList(),
        total: int.tryParse('${json['total'] ?? 0}') ?? 0,
        limit: int.tryParse('${json['limit'] ?? 20}') ?? 20,
        offset: int.tryParse('${json['offset'] ?? 0}') ?? 0,
      );
}

class MentorPage {
  const MentorPage({
    required this.mentors,
    required this.total,
    required this.limit,
    required this.offset,
  });

  final List<Mentor> mentors;
  final int total;
  final int limit;
  final int offset;

  factory MentorPage.fromJson(Map<String, dynamic> json) => MentorPage(
        mentors: (json['mentors'] as List? ?? const [])
            .map((e) => Mentor.fromJson(e as Map<String, dynamic>))
            .toList(),
        total: int.tryParse('${json['total'] ?? 0}') ?? 0,
        limit: int.tryParse('${json['limit'] ?? 20}') ?? 20,
        offset: int.tryParse('${json['offset'] ?? 0}') ?? 0,
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
