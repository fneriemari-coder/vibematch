/// Models for GET /mastermind/sessions and GET /mastermind/sessions/:id/access.

class MastermindSession {
  const MastermindSession({
    required this.id,
    required this.title,
    required this.accessFee,
    required this.currency,
    required this.scheduledFor,
    required this.hostName,
    required this.bookingsCount,
    required this.hasLiveStreamUrl,
  });

  final String id;
  final String title;
  final String accessFee;
  final String currency;
  final DateTime scheduledFor;
  final String hostName;
  final int bookingsCount;
  final bool hasLiveStreamUrl;

  factory MastermindSession.fromJson(Map<String, dynamic> json) => MastermindSession(
        id: json['id'] as String,
        title: json['title'] as String? ?? '',
        accessFee: json['accessFee']?.toString() ?? '0',
        currency: json['currency'] as String? ?? 'USD',
        scheduledFor: DateTime.parse(json['scheduledFor'] as String),
        hostName: (json['host'] as Map<String, dynamic>?)?['profile']?['name'] as String? ?? 'Host',
        bookingsCount: (json['_count'] as Map<String, dynamic>?)?['bookings'] as int? ?? 0,
        hasLiveStreamUrl: json['liveStreamUrl'] != null,
      );
}

class MastermindAccess {
  const MastermindAccess({required this.title, required this.scheduledFor, required this.liveStreamUrl});

  final String title;
  final DateTime scheduledFor;
  final String liveStreamUrl;

  factory MastermindAccess.fromJson(Map<String, dynamic> json) => MastermindAccess(
        title: json['title'] as String? ?? '',
        scheduledFor: DateTime.parse(json['scheduledFor'] as String),
        liveStreamUrl: json['liveStreamUrl'] as String,
      );
}
