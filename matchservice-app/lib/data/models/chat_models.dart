/// Models for GET /chat/matches — the conversations list.

class Conversation {
  const Conversation({
    required this.matchId,
    required this.type,
    required this.otherUserId,
    required this.otherUserName,
    required this.otherUserSkills,
    required this.lastMessage,
    required this.lastMessageAt,
    required this.lastMessageFromMe,
    required this.createdAt,
  });

  final String matchId;

  /// `SERVICE` or `B2B` — a B2B match is a partnership, not a hire, and the
  /// list labels it so the two never get confused.
  final String type;
  final String otherUserId;
  final String otherUserName;
  final List<String> otherUserSkills;

  /// Null until someone sends the first message.
  final String? lastMessage;
  final DateTime? lastMessageAt;
  final bool? lastMessageFromMe;
  final DateTime createdAt;

  bool get hasMessages => lastMessage != null;

  /// Falls back to the match date so a brand-new conversation still sorts and
  /// renders a timestamp instead of an empty slot.
  DateTime get sortedAt => lastMessageAt ?? createdAt;

  factory Conversation.fromJson(Map<String, dynamic> json) => Conversation(
        matchId: json['matchId'] as String,
        type: json['type'] as String? ?? 'SERVICE',
        otherUserId: json['otherUserId'] as String? ?? '',
        otherUserName: json['otherUserName'] as String? ?? 'Usuário',
        otherUserSkills:
            (json['otherUserSkills'] as List?)?.cast<String>() ?? const [],
        lastMessage: json['lastMessage'] as String?,
        lastMessageAt: json['lastMessageAt'] == null
            ? null
            : DateTime.parse(json['lastMessageAt'] as String),
        lastMessageFromMe: json['lastMessageFromMe'] as bool?,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}
