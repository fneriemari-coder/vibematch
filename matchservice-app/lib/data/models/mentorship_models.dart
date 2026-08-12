/// Models for the one-to-one mentorship endpoints:
/// GET  /mentorship/offerings
/// POST /mentorship/slots/:slotId/book
/// GET  /mentorship/bookings

/// Wire values of `status` on a booking, mapped to their Portuguese label.
/// Unknown values fall through to the raw string rather than being hidden —
/// a status the app has not learned about yet is still information.
const Map<String, String> mentorshipStatusLabels = <String, String>{
  'PENDING': 'Aguardando pagamento',
  'CONFIRMED': 'Confirmada',
  'COMPLETED': 'Realizada',
  'CANCELLED': 'Cancelada',
  'CANCELED': 'Cancelada',
  'REFUNDED': 'Reembolsada',
  'NO_SHOW': 'Não compareceu',
};

String mentorshipStatusLabel(String status) =>
    mentorshipStatusLabels[status.toUpperCase()] ?? status;

/// One bookable time on a mentor's calendar.
class MentorshipSlot {
  const MentorshipSlot({required this.id, required this.startsAt});

  final String id;

  /// Null when the server sends an unparseable date — the chip then shows the
  /// slot as "horário a confirmar" instead of an epoch timestamp.
  final DateTime? startsAt;

  factory MentorshipSlot.fromJson(Map<String, dynamic> json) => MentorshipSlot(
        id: json['id'] as String? ?? '',
        startsAt: DateTime.tryParse('${json['startsAt'] ?? ''}'),
      );
}

/// A mentor's published one-to-one session: what it is, how long, what it
/// costs, and when it can be taken.
class MentorshipOffering {
  const MentorshipOffering({
    required this.id,
    required this.mentorId,
    required this.mentorName,
    required this.mentorHeadline,
    required this.kScore,
    required this.title,
    required this.description,
    required this.durationMinutes,
    required this.price,
    required this.currency,
    required this.topics,
    required this.nextSlots,
  });

  final String id;
  final String mentorId;
  final String mentorName;
  final String mentorHeadline;
  final double kScore;
  final String title;
  final String description;
  final int durationMinutes;

  /// Prisma `Decimal` — a JSON number or a string depending on the serializer,
  /// so it is carried as a string and formatted at the edge by `formatMoney`.
  final String? price;
  final String currency;
  final List<String> topics;

  /// Already sorted by the API. Empty means the mentor has nothing open.
  final List<MentorshipSlot> nextSlots;

  bool get hasSlots => nextSlots.isNotEmpty;

  factory MentorshipOffering.fromJson(Map<String, dynamic> json) =>
      MentorshipOffering(
        id: json['id'] as String? ?? '',
        mentorId: json['mentorId'] as String? ?? '',
        mentorName: json['mentorName'] as String? ?? '',
        mentorHeadline: json['mentorHeadline'] as String? ?? '',
        kScore: double.tryParse('${json['kScore'] ?? 0}') ?? 0,
        title: json['title'] as String? ?? '',
        description: json['description'] as String? ?? '',
        durationMinutes: int.tryParse('${json['durationMinutes'] ?? 0}') ?? 0,
        price: json['price']?.toString(),
        currency: json['currency'] as String? ?? 'BRL',
        topics: (json['topics'] as List?)
                ?.map((e) => '${e ?? ''}'.trim())
                .where((e) => e.isNotEmpty)
                .toList(growable: false) ??
            const [],
        nextSlots: (json['nextSlots'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => MentorshipSlot.fromJson(e.cast<String, dynamic>()))
            .toList(growable: false),
      );
}

class MentorshipOfferingPage {
  const MentorshipOfferingPage({
    required this.offerings,
    required this.total,
    required this.limit,
    required this.offset,
  });

  final List<MentorshipOffering> offerings;
  final int total;
  final int limit;
  final int offset;

  factory MentorshipOfferingPage.fromJson(Map<String, dynamic> json) =>
      MentorshipOfferingPage(
        offerings: (json['offerings'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => MentorshipOffering.fromJson(e.cast<String, dynamic>()))
            .toList(growable: false),
        total: int.tryParse('${json['total'] ?? 0}') ?? 0,
        limit: int.tryParse('${json['limit'] ?? 20}') ?? 20,
        offset: int.tryParse('${json['offset'] ?? 0}') ?? 0,
      );
}

/// A session the signed-in user booked with someone else.
class MenteeBooking {
  const MenteeBooking({
    required this.id,
    required this.offeringTitle,
    required this.mentorName,
    required this.startsAt,
    required this.status,
    required this.pricePaid,
    required this.currency,
    required this.meetingUrl,
  });

  final String id;
  final String offeringTitle;
  final String mentorName;
  final DateTime? startsAt;
  final String status;
  final String? pricePaid;
  final String currency;

  /// Null until the mentor publishes the room. The UI says so explicitly
  /// rather than offering a button that would go nowhere.
  final String? meetingUrl;

  String get statusLabel => mentorshipStatusLabel(status);

  bool get isConfirmed {
    final upper = status.toUpperCase();
    return upper == 'CONFIRMED' || upper == 'COMPLETED';
  }

  bool get hasMeetingUrl => (meetingUrl ?? '').trim().isNotEmpty;

  factory MenteeBooking.fromJson(Map<String, dynamic> json) => MenteeBooking(
        id: json['id'] as String? ?? '',
        offeringTitle: json['offeringTitle'] as String? ?? '',
        mentorName: json['mentorName'] as String? ?? '',
        startsAt: DateTime.tryParse('${json['startsAt'] ?? ''}'),
        status: json['status'] as String? ?? '',
        pricePaid: json['pricePaid']?.toString(),
        currency: json['currency'] as String? ?? 'BRL',
        meetingUrl: json['meetingUrl'] as String?,
      );
}

/// A session someone booked with the signed-in user.
class MentorBooking {
  const MentorBooking({
    required this.id,
    required this.offeringTitle,
    required this.menteeName,
    required this.startsAt,
    required this.status,
  });

  final String id;
  final String offeringTitle;
  final String menteeName;
  final DateTime? startsAt;
  final String status;

  String get statusLabel => mentorshipStatusLabel(status);

  factory MentorBooking.fromJson(Map<String, dynamic> json) => MentorBooking(
        id: json['id'] as String? ?? '',
        offeringTitle: json['offeringTitle'] as String? ?? '',
        menteeName: json['menteeName'] as String? ?? '',
        startsAt: DateTime.tryParse('${json['startsAt'] ?? ''}'),
        status: json['status'] as String? ?? '',
      );
}

/// GET /mentorship/bookings — both sides of the table in one response. Someone
/// who mentors and is mentored sees both without switching accounts.
class MentorshipBookings {
  const MentorshipBookings({required this.asMentee, required this.asMentor});

  final List<MenteeBooking> asMentee;
  final List<MentorBooking> asMentor;

  bool get isEmpty => asMentee.isEmpty && asMentor.isEmpty;

  factory MentorshipBookings.fromJson(Map<String, dynamic> json) =>
      MentorshipBookings(
        asMentee: (json['asMentee'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => MenteeBooking.fromJson(e.cast<String, dynamic>()))
            .toList(growable: false),
        asMentor: (json['asMentor'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => MentorBooking.fromJson(e.cast<String, dynamic>()))
            .toList(growable: false),
      );
}
