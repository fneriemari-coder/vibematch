import '../../core/api/dio_client.dart';
import '../models/chat_models.dart';

class ChatRepository {
  ChatRepository(this._client);

  final DioClient _client;

  /// Active matches, most recently active first (the server does the ordering).
  Future<List<Conversation>> listConversations() async {
    final response = await _client.dio.get('/chat/matches');
    return (response.data as List)
        .map((e) => Conversation.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// A room's history, oldest first (the server does the ordering).
  ///
  /// Nothing called this endpoint, so `ChatRoomScreen` started from an empty
  /// list every time and only ever rendered messages that happened to arrive
  /// over the socket while it was open — reopening any conversation showed a
  /// blank room even when both sides had been talking for weeks.
  Future<List<ChatMessage>> getMessages(String matchId) async {
    final response = await _client.dio.get('/chat/$matchId/messages');
    return (response.data as List)
        .map((e) => ChatMessage.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
