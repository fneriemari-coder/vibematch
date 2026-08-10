import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/mastermind_models.dart';
import '../../data/repositories/mastermind_repository.dart';
import '../widgets/vibe_glass_card.dart';

/// Lists upcoming Live Masterminds, lets a client book one (Stripe Checkout
/// for the access fee) and, once booked and inside the access window, join
/// the host's real stream link.
class MastermindScreen extends StatefulWidget {
  const MastermindScreen({super.key, required this.repository});

  final MastermindRepository repository;

  @override
  State<MastermindScreen> createState() => _MastermindScreenState();
}

class _MastermindScreenState extends State<MastermindScreen> {
  late Future<List<MastermindSession>> _sessionsFuture;
  final _busySessionIds = <String>{};

  @override
  void initState() {
    super.initState();
    _sessionsFuture = widget.repository.listUpcoming();
  }

  Future<void> _refresh() async {
    setState(() => _sessionsFuture = widget.repository.listUpcoming());
    await _sessionsFuture;
  }

  Future<void> _book(MastermindSession session) async {
    setState(() => _busySessionIds.add(session.id));
    try {
      final checkoutUrl = await widget.repository.bookSession(session.id);
      if (checkoutUrl == null) return;
      final uri = Uri.parse(checkoutUrl);
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on DioException catch (e) {
      if (!mounted) return;
      final message = e.response?.data?['message']?.toString() ?? 'Não foi possível reservar esta sessão.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _busySessionIds.remove(session.id));
    }
  }

  Future<void> _access(MastermindSession session) async {
    setState(() => _busySessionIds.add(session.id));
    try {
      final access = await widget.repository.getAccess(session.id);
      final uri = Uri.parse(access.liveStreamUrl);
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on DioException catch (e) {
      if (!mounted) return;
      final message = e.response?.data?['message']?.toString() ?? 'Acesso indisponível no momento.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _busySessionIds.remove(session.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Live Masterminds')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<MastermindSession>>(
          future: _sessionsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator(color: VibeMatchColors.neonPrimary));
            }
            final sessions = snapshot.data ?? const [];
            if (sessions.isEmpty) {
              return ListView(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text('Nenhuma sessão agendada no momento.', style: VibeMatchTextStyles.body),
                  ),
                ],
              );
            }
            final formatter = DateFormat('dd/MM/yyyy HH:mm');
            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: sessions.length,
              itemBuilder: (context, index) {
                final session = sessions[index];
                final busy = _busySessionIds.contains(session.id);
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: VibeGlassCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(session.title, style: VibeMatchTextStyles.subheading),
                        const SizedBox(height: 4),
                        Text('com ${session.hostName}', style: VibeMatchTextStyles.body),
                        const SizedBox(height: 4),
                        Text(formatter.format(session.scheduledFor.toLocal()), style: VibeMatchTextStyles.body),
                        const SizedBox(height: 12),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('${session.currency} ${session.accessFee}', style: VibeMatchTextStyles.scoreDigits),
                            Row(
                              children: [
                                OutlinedButton(
                                  onPressed: busy ? null : () => _book(session),
                                  child: const Text('Reservar'),
                                ),
                                const SizedBox(width: 8),
                                ElevatedButton(
                                  onPressed: busy ? null : () => _access(session),
                                  child: busy
                                      ? const SizedBox(
                                          height: 16,
                                          width: 16,
                                          child: CircularProgressIndicator(strokeWidth: 2),
                                        )
                                      : const Text('Acessar'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
