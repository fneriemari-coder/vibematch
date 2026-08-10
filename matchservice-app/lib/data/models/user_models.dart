enum UserRole { client, provider, both, admin }

UserRole userRoleFromJson(String value) => UserRole.values.firstWhere(
  (r) => r.name.toUpperCase() == value,
  orElse: () => UserRole.client,
);

class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.role,
    required this.country,
    required this.walletBalance,
  });

  final String id;
  final String email;
  final UserRole role;
  final String country;
  final double walletBalance;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
    id: json['id'] as String,
    email: json['email'] as String,
    role: userRoleFromJson(json['role'] as String),
    country: json['country'] as String,
    walletBalance: double.tryParse('${json['walletBalance'] ?? 0}') ?? 0,
  );

  bool get isBrazil => country == 'BR';
}

class SwipeCandidate {
  const SwipeCandidate({
    required this.userId,
    required this.name,
    required this.bio,
    required this.skills,
    required this.averageRating,
    required this.hourlyRate,
    required this.rateCurrency,
    required this.financialHealthScore,
    this.distanceMeters,
    this.isProBoosted,
  });

  final String userId;
  final String name;
  final String bio;
  final List<String> skills;
  final double averageRating;
  final String? hourlyRate;
  final String rateCurrency;
  final int? financialHealthScore;
  final double? distanceMeters;
  final bool? isProBoosted;

  factory SwipeCandidate.fromJson(Map<String, dynamic> json) => SwipeCandidate(
    userId: json['userId'] as String,
    name: json['name'] as String? ?? '',
    bio: json['bio'] as String? ?? '',
    skills: (json['skills'] as List?)?.cast<String>() ?? const [],
    averageRating: double.tryParse('${json['averageRating'] ?? 0}') ?? 0,
    hourlyRate: json['hourlyRate']?.toString(),
    rateCurrency: json['rateCurrency'] as String? ?? 'USD',
    financialHealthScore: json['financialHealthScore'] as int?,
    distanceMeters: (json['distanceMeters'] as num?)?.toDouble(),
    isProBoosted: json['isProBoosted'] as bool?,
  );
}
