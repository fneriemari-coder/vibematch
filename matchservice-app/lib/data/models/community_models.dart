/// Models for GET /communities, GET /communities/:communityId and
/// POST /communities/:communityId/apply — the paid peer groups.

/// Wire values of `Community.tier`, mapped to their display label.
const Map<String, String> communityTierLabels = <String, String>{
  'CIRCULO': 'Círculo',
  'SCALE': 'Scale',
  'CONSELHO': 'Conselho',
};

String communityTierLabel(String tier) => communityTierLabels[tier] ?? tier;

class Community {
  const Community({
    required this.id,
    required this.tier,
    required this.name,
    required this.tagline,
    required this.description,
    required this.monthlyFee,
    required this.currency,
    required this.cadence,
    required this.seatLimit,
    required this.seatsTaken,
    required this.seatsAvailable,
    required this.minKScore,
    required this.focusTopics,
    required this.hostName,
    required this.hostId,
    required this.isMember,
    required this.eligible,
  });

  final String id;
  final String tier;
  final String name;
  final String tagline;
  final String description;

  /// Prisma Decimal — string or number on the wire, formatted at the edge.
  final String? monthlyFee;
  final String currency;

  /// Free text from the host, e.g. "Encontros quinzenais, terças 19h".
  final String cadence;
  final int seatLimit;
  final int seatsTaken;
  final int seatsAvailable;
  final double minKScore;
  final List<String> focusTopics;
  final String hostName;
  final String hostId;
  final bool isMember;

  /// False when the caller's K-Score is below [minKScore]. The card stays
  /// visible either way — hiding it would make the tier invisible to exactly
  /// the people it is meant to motivate.
  final bool eligible;

  String get tierLabel => communityTierLabel(tier);

  /// 0..1, for the seats bar. Guards a zero/absent seatLimit so the bar never
  /// divides by zero on a community with no declared cap.
  double get seatsFilledFraction {
    if (seatLimit <= 0) return 0;
    return (seatsTaken / seatLimit).clamp(0.0, 1.0);
  }

  factory Community.fromJson(Map<String, dynamic> json) {
    final seatLimit = int.tryParse('${json['seatLimit'] ?? 0}') ?? 0;
    final seatsTaken = int.tryParse('${json['seatsTaken'] ?? 0}') ?? 0;
    return Community(
      id: json['id'] as String? ?? '',
      tier: json['tier'] as String? ?? '',
      name: json['name'] as String? ?? '',
      tagline: json['tagline'] as String? ?? '',
      description: json['description'] as String? ?? '',
      monthlyFee: json['monthlyFee']?.toString(),
      currency: json['currency'] as String? ?? 'BRL',
      cadence: json['cadence'] as String? ?? '',
      seatLimit: seatLimit,
      seatsTaken: seatsTaken,
      // Derived locally when the server omits it, so the "vagas restantes"
      // line is never blank on an otherwise complete record.
      seatsAvailable: int.tryParse('${json['seatsAvailable'] ?? ''}') ??
          (seatLimit - seatsTaken).clamp(0, seatLimit),
      minKScore: double.tryParse('${json['minKScore'] ?? 0}') ?? 0,
      focusTopics: (json['focusTopics'] as List?)?.cast<String>() ?? const [],
      hostName: json['hostName'] as String? ?? '',
      hostId: json['hostId'] as String? ?? '',
      isMember: json['isMember'] as bool? ?? false,
      eligible: json['eligible'] as bool? ?? false,
    );
  }
}

class CommunityMember {
  const CommunityMember({
    required this.userId,
    required this.name,
    required this.headline,
    required this.skills,
    required this.contributionScore,
  });

  final String userId;
  final String name;
  final String headline;
  final List<String> skills;
  final double contributionScore;

  factory CommunityMember.fromJson(Map<String, dynamic> json) =>
      CommunityMember(
        userId: json['userId'] as String? ?? '',
        name: json['name'] as String? ?? '',
        headline: json['headline'] as String? ?? '',
        skills: (json['skills'] as List?)?.cast<String>() ?? const [],
        contributionScore:
            double.tryParse('${json['contributionScore'] ?? 0}') ?? 0,
      );
}

class CommunityDetail {
  const CommunityDetail({
    required this.community,
    required this.members,
    required this.isMember,
  });

  final Community community;
  final List<CommunityMember> members;

  /// `myMembership` is a record when the caller belongs to the group and null
  /// otherwise; only its presence matters to the UI.
  final bool isMember;

  factory CommunityDetail.fromJson(Map<String, dynamic> json) =>
      CommunityDetail(
        community: Community.fromJson(json),
        members: (json['members'] as List? ?? const [])
            .map((e) => CommunityMember.fromJson(e as Map<String, dynamic>))
            .toList(),
        isMember: json['myMembership'] != null ||
            (json['isMember'] as bool? ?? false),
      );
}
