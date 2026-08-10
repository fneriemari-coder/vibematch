enum AccountStatus { active, underReview, suspended }

AccountStatus accountStatusFromJson(String value) => AccountStatus.values.firstWhere(
      (s) => s.apiValue == value,
      orElse: () => AccountStatus.active,
    );

extension AccountStatusApi on AccountStatus {
  String get apiValue => switch (this) {
        AccountStatus.active => 'ACTIVE',
        AccountStatus.underReview => 'UNDER_REVIEW',
        AccountStatus.suspended => 'SUSPENDED',
      };

  String get label => switch (this) {
        AccountStatus.active => 'Ativa',
        AccountStatus.underReview => 'Em revisão',
        AccountStatus.suspended => 'Banida',
      };
}

class AdminUserSummary {
  const AdminUserSummary({
    required this.id,
    required this.email,
    required this.role,
    required this.accountStatus,
    required this.identityVerified,
    required this.emailVerified,
    required this.walletBalance,
    required this.country,
    required this.deletedAt,
    required this.name,
  });

  final String id;
  final String email;
  final String role;
  final AccountStatus accountStatus;
  final bool identityVerified;
  final bool emailVerified;
  final String walletBalance;
  final String country;
  final DateTime? deletedAt;
  final String name;

  factory AdminUserSummary.fromJson(Map<String, dynamic> json) => AdminUserSummary(
        id: json['id'] as String,
        email: json['email'] as String,
        role: json['role'] as String,
        accountStatus: accountStatusFromJson(json['accountStatus'] as String),
        identityVerified: json['identityVerified'] as bool? ?? false,
        emailVerified: json['emailVerified'] as bool? ?? false,
        walletBalance: json['walletBalance']?.toString() ?? '0',
        country: json['country'] as String? ?? '',
        deletedAt: json['deletedAt'] != null ? DateTime.parse(json['deletedAt'] as String) : null,
        name: (json['profile'] as Map<String, dynamic>?)?['name'] as String? ?? '(sem perfil)',
      );
}

class AdminUserListResult {
  const AdminUserListResult({required this.users, required this.total, required this.limit, required this.offset});

  final List<AdminUserSummary> users;
  final int total;
  final int limit;
  final int offset;

  factory AdminUserListResult.fromJson(Map<String, dynamic> json) => AdminUserListResult(
        users: (json['users'] as List).map((e) => AdminUserSummary.fromJson(e as Map<String, dynamic>)).toList(),
        total: json['total'] as int,
        limit: json['limit'] as int,
        offset: json['offset'] as int,
      );
}
