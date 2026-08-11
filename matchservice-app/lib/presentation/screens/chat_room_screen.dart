import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;

import '../../core/api/dio_client.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../data/models/chat_models.dart';
import '../../data/repositories/chat_repository.dart';
import '../widgets/vibe_ui.dart';

/// A single conversation.
///
/// The room used to start from an empty list and only append what arrived over
/// the socket while it was open, so reopening any conversation showed a blank
/// screen — the history endpoint existed and nothing called it. It now fetches
/// the history and connects the socket at the same time, merging the two by
/// message id: a message can legitimately reach the screen twice (delivered
/// live, then again in a history fetch that finished afterwards) and must only
/// be drawn once.
class ChatRoomScreen extends StatefulWidget {
  const ChatRoomScreen({
    super.key,
    required this.matchId,
    required this.socketBaseUrl,
    required this.chatRepository,
  });

  final String matchId;
  final String socketBaseUrl;
  final ChatRepository chatRepository;

  @override
  State<ChatRoomScreen> createState() => _ChatRoomScreenState();
}

class _ChatRoomScreenState extends State<ChatRoomScreen> {
  socket_io.Socket? _socket;
  final _inputController = TextEditingController();

  /// Oldest first. Rendered bottom-up so the newest message is on screen.
  final _messages = <ChatMessage>[];

  /// Ids already on screen — the merge key between history and live traffic.
  final _seenIds = <String>{};

  bool _loadingHistory = true;

  /// Set when the history fetch failed. The socket is untouched by this: live
  /// messages keep arriving and rendering, and only the older ones are missing,
  /// so the failure is a banner over a working room rather than an error page
  /// that would throw the live connection away.
  String? _historyError;

  @override
  void initState() {
    super.initState();
    // Both start now. Neither waits on the other: a slow history fetch must not
    // delay the connection, and a failed one must not prevent it.
    _loadHistory();
    _connect();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _loadingHistory = true;
      _historyError = null;
    });
    try {
      final history = await widget.chatRepository.getMessages(widget.matchId);
      if (!mounted) return;
      setState(() {
        _merge(history);
        _loadingHistory = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _historyError = describeApiError(
          error,
          fallback: 'Não foi possível carregar as mensagens anteriores.',
        );
        _loadingHistory = false;
      });
    }
  }

  /// Adds only messages not already on screen, then restores chronological
  /// order — history can land after live messages have already been appended.
  void _merge(Iterable<ChatMessage> incoming) {
    var added = false;
    for (final message in incoming) {
      // A message with no id cannot be deduped; keeping it is better than
      // dropping something the user was sent.
      if (message.id.isNotEmpty && !_seenIds.add(message.id)) continue;
      _messages.add(message);
      added = true;
    }
    if (added) {
      _messages.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    }
  }

  Future<void> _connect() async {
    final token = await DioClient.readToken();
    if (!mounted) return;
    _socket = socket_io.io(
      '${widget.socketBaseUrl}/chat',
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .disableAutoConnect()
          .build(),
    );
    _socket!
      ..connect()
      ..onConnect(
        (_) => _socket!.emit('joinMatch', {'matchId': widget.matchId}),
      )
      ..on('newMessage', (data) {
        if (!mounted || data is! Map) return;
        setState(
          () => _merge([
            ChatMessage.fromJson(Map<String, dynamic>.from(data)),
          ]),
        );
      });
  }

  void _send() {
    final text = _inputController.text.trim();
    if (text.isEmpty) return;
    _socket?.emit('sendMessage', {'matchId': widget.matchId, 'content': text});
    _inputController.clear();
  }

  @override
  void dispose() {
    _socket?.dispose();
    _inputController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Chat')),
      body: Column(
        children: [
          if (_historyError != null)
            _HistoryErrorBanner(
              message: _historyError!,
              onRetry: _loadHistory,
            ),
          Expanded(child: _body()),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _inputController,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        hintText: 'Mensagem...',
                      ),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(
                      Icons.send,
                      color: VibeMatchColors.neonPrimary,
                    ),
                    onPressed: _send,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    // Only a genuinely empty room gets the spinner — once anything is on
    // screen, a still-running fetch must not blank it out.
    if (_loadingHistory && _messages.isEmpty) {
      return const Center(
        child: CircularProgressIndicator(color: VibeMatchColors.neonPrimary),
      );
    }
    if (_messages.isEmpty) {
      return const VibeEmptyState(
        icon: Icons.chat_bubble_outline_rounded,
        title: 'Nenhuma mensagem ainda',
        message: 'Vocês deram match. Escreva a primeira mensagem.',
      );
    }

    // Reversed so the list opens on the newest message and stays anchored
    // there as new ones arrive.
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.all(16),
      itemCount: _messages.length,
      itemBuilder: (context, index) => _MessageBubble(
        message: _messages[_messages.length - 1 - index],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: VibeMatchColors.surface,
          borderRadius: VibeMatchRadii.buttonRadius,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(message.content, style: VibeMatchTextStyles.subheading),
            if (message.translatedContent != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  message.translatedContent!,
                  style: VibeMatchTextStyles.body.copyWith(
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _HistoryErrorBanner extends StatelessWidget {
  const _HistoryErrorBanner({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: VibeMatchColors.slate,
      padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
      child: Row(
        children: [
          const Icon(
            Icons.history_toggle_off_rounded,
            size: 18,
            color: VibeMatchColors.textLow,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: VibeMatchTextStyles.caption),
          ),
          TextButton(onPressed: onRetry, child: const Text('Tentar de novo')),
        ],
      ),
    );
  }
}
