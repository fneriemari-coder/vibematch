import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/api/dio_client.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/chat_models.dart';
import '../../data/repositories/chat_repository.dart';
import '../widgets/vibe_ui.dart';
import 'chat_room_screen.dart';

/// Conversations list — the way back into a chat room.
///
/// `ChatRoomScreen` existed but nothing linked to it except the "deu match"
/// screen, so a conversation was only ever reachable in the seconds right after
/// it opened. This screen is what makes matches persist as something a user can
/// return to.
class ConversationsScreen extends StatefulWidget {
  const ConversationsScreen({
    super.key,
    required this.chatRepository,
    this.showAppBar = true,
  });

  final ChatRepository chatRepository;

  /// False when hosted inside the shell, which draws its own header.
  final bool showAppBar;

  @override
  State<ConversationsScreen> createState() => _ConversationsScreenState();
}

class _ConversationsScreenState extends State<ConversationsScreen> {
  late Future<List<Conversation>> _conversations;

  @override
  void initState() {
    super.initState();
    _conversations = widget.chatRepository.listConversations();
  }

  void _reload() {
    setState(() => _conversations = widget.chatRepository.listConversations());
  }

  void _open(Conversation conversation) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChatRoomScreen(
          matchId: conversation.matchId,
          // The chat gateway is served by the API process itself, so its
          // origin is whatever the REST client is already pointed at.
          socketBaseUrl: context.read<DioClient>().dio.options.baseUrl,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: widget.showAppBar ? AppBar(title: const Text('Conversas')) : null,
      body: SafeArea(
        child: RefreshIndicator(
          color: VibeMatchColors.neonPrimary,
          backgroundColor: VibeMatchColors.surface,
          onRefresh: () async {
            final refreshed = widget.chatRepository.listConversations();
            setState(() => _conversations = refreshed);
            await refreshed.catchError((_) => <Conversation>[]);
          },
          child: FutureBuilder<List<Conversation>>(
            future: _conversations,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(
                  child: CircularProgressIndicator(
                    color: VibeMatchColors.neonPrimary,
                  ),
                );
              }
              if (snapshot.hasError) {
                return ListView(
                  children: [
                    VibeErrorState(
                      message: 'Não conseguimos carregar suas conversas.',
                      onRetry: _reload,
                    ),
                  ],
                );
              }
              final conversations = snapshot.data ?? const <Conversation>[];
              if (conversations.isEmpty) {
                return ListView(
                  children: const [
                    VibeEmptyState(
                      icon: Icons.forum_outlined,
                      title: 'Nenhuma conversa ainda',
                      message:
                          'Quando você e outra pessoa derem match, a conversa aparece aqui '
                          'e fica guardada.',
                    ),
                  ],
                );
              }
              return ListView.separated(
                padding: const EdgeInsets.symmetric(
                  horizontal: VibeMatchSpacing.gutter,
                  vertical: 16,
                ),
                itemCount: conversations.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, i) => _ConversationTile(
                  conversation: conversations[i],
                  onTap: () => _open(conversations[i]),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _ConversationTile extends StatelessWidget {
  const _ConversationTile({required this.conversation, required this.onTap});

  final Conversation conversation;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final preview = conversation.hasMessages
        ? '${conversation.lastMessageFromMe == true ? 'Você: ' : ''}${conversation.lastMessage}'
        : 'Vocês deram match. Diga olá.';

    return VibeCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Avatar(name: conversation.otherUserName),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        conversation.otherUserName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: VibeMatchTextStyles.cardTitle,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _relativeTime(conversation.sortedAt),
                      style: VibeMatchTextStyles.caption.copyWith(fontSize: 11),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  preview,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: VibeMatchTextStyles.body.copyWith(
                    fontStyle: conversation.hasMessages
                        ? FontStyle.normal
                        : FontStyle.italic,
                  ),
                ),
                if (conversation.type == 'B2B' ||
                    conversation.otherUserSkills.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (conversation.type == 'B2B')
                        const VibeTag(label: 'Parceria B2B'),
                      ...conversation.otherUserSkills
                          .take(2)
                          .map((s) => VibeTag(label: s)),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _relativeTime(DateTime when) {
    final delta = DateTime.now().difference(when);
    if (delta.inMinutes < 1) return 'agora';
    if (delta.inMinutes < 60) return '${delta.inMinutes} min';
    if (delta.inHours < 24) return '${delta.inHours} h';
    if (delta.inDays < 7) return '${delta.inDays} d';
    return '${when.day}/${when.month}';
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    final initials = parts.isEmpty
        ? '?'
        : parts.length == 1
            ? parts.first.characters.first.toUpperCase()
            : '${parts.first.characters.first}${parts.last.characters.first}'
                .toUpperCase();

    return Container(
      height: 46,
      width: 46,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: VibeMatchColors.coverGradientFor(name),
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: VibeMatchRadii.buttonRadius,
        border: Border.all(color: VibeMatchColors.border),
      ),
      child: Text(
        initials,
        style: VibeMatchTextStyles.subheading.copyWith(
          color: VibeMatchColors.scoreGold,
        ),
      ),
    );
  }
}
