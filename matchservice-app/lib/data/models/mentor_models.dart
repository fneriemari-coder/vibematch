/// Model for GET /academy/mentors — the people who teach on the platform,
/// as opposed to `RecommendedProvider`, which is a service provider surfaced
/// from a course's skill match.

class Mentor {
  const Mentor({
    required this.id,
    required this.name,
    required this.headline,
    required this.bio,
    required this.skills,
    required this.topics,
    required this.averageRating,
    required this.kScore,
    required this.hourlyRate,
    required this.rateCurrency,
    required this.courseCount,
    required this.upcomingSessionCount,
  });

  final String id;
  final String name;
  final String headline;
  final String bio;
  final List<String> skills;
  final List<String> topics;
  final double averageRating;

  /// The platform's own reputation score. Also the gate on the CONSELHO tier
  /// communities, which is why it is surfaced this prominently.
  final double kScore;

  /// Prisma Decimal — arrives as a string or a number, so it is carried as a
  /// string and formatted at the edge (see `formatMoney`).
  final String? hourlyRate;
  final String rateCurrency;
  final int courseCount;
  final int upcomingSessionCount;

  factory Mentor.fromJson(Map<String, dynamic> json) => Mentor(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        headline: json['headline'] as String? ?? '',
        bio: json['bio'] as String? ?? '',
        skills: (json['skills'] as List?)?.cast<String>() ?? const [],
        topics: (json['topics'] as List?)?.cast<String>() ?? const [],
        averageRating: double.tryParse('${json['averageRating'] ?? 0}') ?? 0,
        kScore: double.tryParse('${json['kScore'] ?? 0}') ?? 0,
        hourlyRate: json['hourlyRate']?.toString(),
        rateCurrency: json['rateCurrency'] as String? ?? 'BRL',
        courseCount: int.tryParse('${json['courseCount'] ?? 0}') ?? 0,
        upcomingSessionCount:
            int.tryParse('${json['upcomingSessionCount'] ?? 0}') ?? 0,
      );
}
