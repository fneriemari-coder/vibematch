import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import '../../core/api/dio_client.dart';
import '../../core/theme/vibe_match_theme.dart';

class ChatRoomScreen extends StatefulWidget {
  const ChatRoomScreen({super.key, required this.matchId, required this.socketBaseUrl});

  final String matchId;
  final String socketBaseUrl;

  @override
  State<ChatRoomScreen> createState() => _ChatRoomScreenState();
}

class _ChatRoomScreenState extends State<ChatRoomScreen> {
  socket_io.Socket? _socket;
  final _messages = <Map<String, dynamic>>[];
  final _inputController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _connect();
  }

  Future<void> _connect() async {
    final token = await DioClient.readToken();
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
      ..onConnect((_) => _socket!.emit('joinMatch', {'matchId': widget.matchId}))
      ..on('newMessage', (data) {
        if (!mounted) return;
        setState(() => _messages.add(Map<String, dynamic>.from(data as Map)));
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
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final message = _messages[index];
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
                        Text(message['content'] as String? ?? '', style: VibeMatchTextStyles.subheading),
                        if (message['translatedContent'] != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              message['translatedContent'] as String,
                              style: VibeMatchTextStyles.body.copyWith(fontStyle: FontStyle.italic),
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _inputController,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(hintText: 'Mensagem...'),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send, color: VibeMatchColors.neonPrimary),
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
}
