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
}
