import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/models/academy_models.dart';
import '../../data/models/community_models.dart';
import '../../data/models/mastermind_models.dart';
import '../../data/models/mentor_models.dart';
import '../../data/repositories/academy_repository.dart';
import '../../data/repositories/community_repository.dart';
import '../../data/repositories/mastermind_repository.dart';
import '../widgets/vibe_ui.dart';

/// The "people" half of the platform: the mentors who teach, the live sessions
/// they run, and the paid communities they host. Three tabs rather than three
/// screens because the decision a member is making — who do I learn from, and
/// in what format — is a single one.
class MentorsScreen extends StatelessWidget {
  const MentorsScreen({
    super.key,
    required this.academyRepository,
    required this.mastermindRepository,
    required this.communityRepository,
  });

  final AcademyRepository academyRepository;
  final MastermindRepository mastermindRepository;
  final CommunityRepository communityRepository;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        backgroundColor: VibeMatchColors.background,
        appBar: AppBar(
          title: const Text('Mentoria'),
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            labelColor: VibeMatchColors.neonPrimary,
            unselectedLabelColor: VibeMatchColors.textLow,
            indicatorColor: VibeMatchColors.neonPrimary,
            indicatorSize: TabBarIndicatorSize.label,
            dividerColor: VibeMatchColors.border,
            labelStyle: VibeMatchTextStyles.button,
            unselectedLabelStyle: VibeMatchTextStyles.button,
            tabs: const [
              Tab(text: 'Mentores'),
              Tab(text: 'Ao vivo'),
              Tab(text: 'Comunidades'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _MentorsTab(repository: academyRepository),
            _LiveTab(repository: mastermindRepository),
            _CommunitiesTab(repository: communityRepository),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Mentores
// ---------------------------------------------------------------------------

class _MentorsTab extends StatefulWidget {
  const _MentorsTab({required this.repository});

  final AcademyRepository repository;

  @override
  State<_MentorsTab> createState() => _MentorsTabState();
}

class _MentorsTabState extends State<_MentorsTab>
    with AutomaticKeepAliveClientMixin {
  final _searchController = TextEditingController();

  Timer? _debounce;
  bool _loading = true;
  String? _error;
  MentorPage? _page;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.repository.listMentors(
        search: _searchController.text,
      );
      if (!mounted) return;
      setState(() {
        _page = page;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível carregar os mentores.',
        );
        _loading = false;
      });
    }
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _load);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final mentors = _page?.mentors ?? const <Mentor>[];

    return RefreshIndicator(
      onRefresh: _load,
      color: VibeMatchColors.neonPrimary,
      backgroundColor: VibeMatchColors.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: VibeMatchSpacing.sectionGap),
        children: [
          VibeContent(
            child: Padding(
              padding: const EdgeInsets.only(top: 20, bottom: 18),
              child: TextField(
                controller: _searchController,
                onChanged: _onSearchChanged,
                onSubmitted: (_) => _load(),
                textInputAction: TextInputAction.search,
                style: VibeMatchTextStyles.body.copyWith(
                  color: VibeMatchColors.textHigh,
                ),
                decoration: const InputDecoration(
                  hintText: 'Buscar mentor por nome ou tema',
                  prefixIcon: Icon(
                    Icons.search_rounded,
                    color: VibeMatchColors.textLow,
                    size: 20,
                  ),
                ),
              ),
            ),
          ),
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 56),
              child: Center(
                child: CircularProgressIndicator(
                  color: VibeMatchColors.neonPrimary,
                ),
              ),
            )
          else if (_error != null)
            VibeErrorState(message: _error!, onRetry: _load)
          else if (mentors.isEmpty)
            VibeEmptyState(
              icon: Icons.psychology_alt_rounded,
              title: _searchController.text.trim().isEmpty
                  ? 'Nenhum mentor disponível'
                  : 'Nenhum mentor para essa busca',
              message: _searchController.text.trim().isEmpty
                  ? 'Os mentores da Academy aparecem aqui assim que abrem '
                      'agenda.'
                  : 'Tente outro nome ou tema.',
              action: _searchController.text.trim().isEmpty
                  ? null
                  : OutlinedButton(
                      onPressed: () {
                        _searchController.clear();
                        _load();
                      },
                      child: const Text('Limpar busca'),
                    ),
            )
          else
            ...mentors.map(
              (mentor) => Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: VibeContent(child: _MentorCard(mentor: mentor)),
              ),
            ),
        ],
      ),
    );
  }
}

class _MentorCard extends StatelessWidget {
  const _MentorCard({required this.mentor});

  final Mentor mentor;

  @override
  Widget build(BuildContext context) {
    final rate = formatMoney(mentor.hourlyRate, mentor.rateCurrency);
    final topics = mentor.topics.isNotEmpty ? mentor.topics : mentor.skills;

    return VibeCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      mentor.name,
                      style: VibeMatchTextStyles.cardTitle.copyWith(
                        fontSize: 18,
                      ),
                    ),
                    if (mentor.headline.isNotEmpty) ...[
                      const SizedBox(height: 5),
                      Text(
                        mentor.headline,
                        style: VibeMatchTextStyles.body,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              if (mentor.kScore > 0) ...[
                const SizedBox(width: 16),
                VibeStat(
                  value: formatScore(mentor.kScore),
                  caption: 'K-Score',
                  size: 30,
                ),
              ],
            ],
          ),
          if (mentor.bio.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              mentor.bio,
              style: VibeMatchTextStyles.body,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (topics.isNotEmpty) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: topics.take(4).map((t) => VibeTag(label: t)).toList(),
            ),
          ],
          const Divider(color: VibeMatchColors.border, height: 28),
          Wrap(
            spacing: 16,
            runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (mentor.averageRating > 0)
                VibeRating(rating: mentor.averageRating, suffix: 'avaliação'),
              _MentorMeta(
                icon: Icons.school_rounded,
                label: '${mentor.courseCount} '
                    '${mentor.courseCount == 1 ? 'curso' : 'cursos'}',
              ),
              _MentorMeta(
                icon: Icons.event_available_rounded,
                label: '${mentor.upcomingSessionCount} '
                    '${mentor.upcomingSessionCount == 1 ? 'sessão' : 'sessões'}'
                    ' na agenda',
              ),
              if (rate != null)
                Text(
                  '$rate/h',
                  style: VibeMatchTextStyles.subheading.copyWith(
                    color: VibeMatchColors.scoreGold,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MentorMeta extends StatelessWidget {
  const _MentorMeta({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: VibeMatchColors.textLow),
        const SizedBox(width: 5),
        Text(label, style: VibeMatchTextStyles.caption),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Ao vivo
// ---------------------------------------------------------------------------

class _LiveTab extends StatefulWidget {
  const _LiveTab({required this.repository});

  final MastermindRepository repository;

  @override
  State<_LiveTab> createState() => _LiveTabState();
}

class _LiveTabState extends State<_LiveTab> with AutomaticKeepAliveClientMixin {
  bool _loading = true;
  String? _error;
  List<MastermindSession> _sessions = const [];
  final _bookingIds = <String>{};
  final _joiningIds = <String>{};

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final sessions = await widget.repository.listUpcoming();
      if (!mounted) return;
      setState(() {
        _sessions = sessions;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível carregar as sessões ao vivo.',
        );
        _loading = false;
      });
    }
  }

  /// Opens the real stream link for someone who already has a paid seat.
  ///
  /// The server only hands the URL over to the host or a confirmed booker, and
  /// only inside the access window, so its rejection message is the honest
  /// explanation of why entry failed — surface it rather than guessing.
  Future<void> _join(MastermindSession session) async {
    setState(() => _joiningIds.add(session.id));
    try {
      final access = await widget.repository.getAccess(session.id);
      if (!mounted) return;
      final uri = Uri.tryParse(access.liveStreamUrl);
      final launched = uri != null &&
          await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Não foi possível abrir a transmissão.')),
        );
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: 'Você ainda não tem acesso a esta sessão.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _joiningIds.remove(session.id));
    }
  }

  Future<void> _book(MastermindSession session) async {
    setState(() => _bookingIds.add(session.id));
    try {
      final checkoutUrl = await widget.repository.bookSession(session.id);
      if (!mounted) return;
      if (checkoutUrl == null || checkoutUrl.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('O checkout desta sessão não está disponível agora.'),
          ),
        );
        return;
      }
      final uri = Uri.tryParse(checkoutUrl);
      final launched = uri != null &&
          await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Não foi possível abrir a página de pagamento.'),
          ),
        );
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: 'Não foi possível reservar esta sessão.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _bookingIds.remove(session.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final now = DateTime.now();

    return RefreshIndicator(
      onRefresh: _load,
      color: VibeMatchColors.neonPrimary,
      backgroundColor: VibeMatchColors.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(
          top: 20,
          bottom: VibeMatchSpacing.sectionGap,
        ),
        children: [
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 56),
              child: Center(
                child: CircularProgressIndicator(
                  color: VibeMatchColors.neonPrimary,
                ),
              ),
            )
          else if (_error != null)
            VibeErrorState(message: _error!, onRetry: _load)
          else if (_sessions.isEmpty)
            const VibeEmptyState(
              icon: Icons.podcasts_rounded,
              title: 'Nenhuma sessão agendada',
              message: 'Os Live Masterminds abrem inscrição alguns dias antes. '
                  'Puxe para atualizar quando a próxima for anunciada.',
            )
          else
            ..._sessions.map(
              (session) => Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: VibeContent(
                  child: _LiveSessionCard(
                    session: session,
                    // "Ao vivo" is the next hour: the join window opens then,
                    // so anything sooner is happening now for practical
                    // purposes and anything later gets a date instead.
                    isLive: session.scheduledFor.difference(now) <=
                        const Duration(hours: 1),
                    busy: _bookingIds.contains(session.id),
                    joining: _joiningIds.contains(session.id),
                    onBook: () => _book(session),
                    onJoin: () => _join(session),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _LiveSessionCard extends StatelessWidget {
  const _LiveSessionCard({
    required this.session,
    required this.isLive,
    required this.busy,
    required this.joining,
    required this.onBook,
    required this.onJoin,
  });

  final MastermindSession session;
  final bool isLive;
  final bool busy;
  final bool joining;
  final VoidCallback onBook;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    final fee = formatMoney(session.accessFee, session.currency);

    return VibeCard(
      padding: const EdgeInsets.all(18),
      highlighted: isLive,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (isLive)
                VibeTag(
                  label: 'Ao vivo',
                  color: VibeMatchColors.live,
                  filled: true,
                  icon: Icons.sensors_rounded,
                )
              else
                Text(
                  formatShortDateTime(session.scheduledFor),
                  style: VibeMatchTextStyles.caption.copyWith(
                    color: VibeMatchColors.scoreGold,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              const Spacer(),
              Text(
                '${formatCount(session.bookingsCount)} '
                '${session.bookingsCount == 1 ? 'inscrito' : 'inscritos'}',
                style: VibeMatchTextStyles.caption,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(session.title, style: VibeMatchTextStyles.sectionTitle),
          const SizedBox(height: 6),
          Text(
            'com ${session.hostName}',
            style: VibeMatchTextStyles.body,
          ),
          if (isLive) ...[
            const SizedBox(height: 6),
            Text(
              formatShortDateTime(session.scheduledFor),
              style: VibeMatchTextStyles.caption,
            ),
          ],
          const Divider(color: VibeMatchColors.border, height: 28),
          Row(
            children: [
              Expanded(
                child: Text(
                  fee ?? 'Acesso gratuito',
                  style: VibeMatchTextStyles.subheading.copyWith(fontSize: 17),
                ),
              ),
              // Only offered once the host has actually published a link;
              // before that there is nothing to enter and the server would
              // reject the request anyway.
              if (session.hasLiveStreamUrl) ...[
                OutlinedButton(
                  onPressed: joining ? null : onJoin,
                  child: joining
                      ? const SizedBox(
                          height: 16,
                          width: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Entrar na sala'),
                ),
                const SizedBox(width: 10),
              ],
              ElevatedButton(
                onPressed: busy ? null : onBook,
                child: busy
                    ? const SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Reservar'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Comunidades
// ---------------------------------------------------------------------------

class _CommunitiesTab extends StatefulWidget {
  const _CommunitiesTab({required this.repository});

  final CommunityRepository repository;

  @override
  State<_CommunitiesTab> createState() => _CommunitiesTabState();
}

class _CommunitiesTabState extends State<_CommunitiesTab>
    with AutomaticKeepAliveClientMixin {
  bool _loading = true;
  String? _error;
  List<Community> _communities = const [];
  final _applyingIds = <String>{};

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final communities = await widget.repository.listCommunities();
      if (!mounted) return;
      setState(() {
        _communities = communities;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível carregar as comunidades.',
        );
        _loading = false;
      });
    }
  }

  Future<void> _apply(Community community) async {
    setState(() => _applyingIds.add(community.id));
    try {
      final checkoutUrl = await widget.repository.apply(community.id);
      if (!mounted) return;
      if (checkoutUrl == null || checkoutUrl.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('O checkout desta comunidade não está disponível.'),
          ),
        );
        return;
      }
      final uri = Uri.tryParse(checkoutUrl);
      final launched = uri != null &&
          await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Não foi possível abrir a página de pagamento.'),
          ),
        );
      }
    } catch (error) {
      if (!mounted) return;
      // The 400 here carries the real reason (K-Score, sem vagas), so it is
      // shown verbatim instead of a generic failure.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: 'Não foi possível enviar sua candidatura.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _applyingIds.remove(community.id));
    }
  }

  void _openMembers(Community community) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: VibeMatchColors.surface,
      isScrollControlled: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(VibeMatchRadii.card),
        ),
      ),
      builder: (_) => _CommunityMembersSheet(
        community: community,
        repository: widget.repository,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);

    return RefreshIndicator(
      onRefresh: _load,
      color: VibeMatchColors.neonPrimary,
      backgroundColor: VibeMatchColors.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(
          top: 20,
          bottom: VibeMatchSpacing.sectionGap,
        ),
        children: [
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 56),
              child: Center(
                child: CircularProgressIndicator(
                  color: VibeMatchColors.neonPrimary,
                ),
              ),
            )
          else if (_error != null)
            VibeErrorState(message: _error!, onRetry: _load)
          else if (_communities.isEmpty)
            const VibeEmptyState(
              icon: Icons.diversity_3_rounded,
              title: 'Nenhuma comunidade aberta',
              message: 'Círculo, Scale e Conselho abrem turmas por temporada. '
                  'Puxe para atualizar quando a próxima abrir.',
            )
          else
            ..._communities.map(
              (community) => Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: VibeContent(
                  child: _CommunityCard(
                    community: community,
                    busy: _applyingIds.contains(community.id),
                    onApply: () => _apply(community),
                    onTap: () => _openMembers(community),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _CommunityCard extends StatelessWidget {
  const _CommunityCard({
    required this.community,
    required this.busy,
    required this.onApply,
    required this.onTap,
  });

  final Community community;
  final bool busy;
  final VoidCallback onApply;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fee = formatMoney(community.monthlyFee, community.currency);
    final lastSeats =
        community.seatsAvailable > 0 && community.seatsAvailable <= 3;

    return VibeCard(
      onTap: onTap,
      padding: const EdgeInsets.all(22),
      highlighted: community.isMember,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                community.tierLabel.toUpperCase(),
                style: VibeMatchTextStyles.eyebrow,
              ),
              const Spacer(),
              if (lastSeats)
                VibeTag(
                  label: 'Últimas vagas',
                  color: VibeMatchColors.live,
                ),
            ],
          ),
          const SizedBox(height: 12),
          Text(community.name, style: VibeMatchTextStyles.sectionTitle),
          if (community.tagline.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(community.tagline, style: VibeMatchTextStyles.body),
          ],
          if (community.description.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              community.description,
              style: VibeMatchTextStyles.body,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 18),
          _SeatsBar(community: community),
          if (community.cadence.isNotEmpty) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                const Icon(
                  Icons.calendar_month_rounded,
                  size: 15,
                  color: VibeMatchColors.textLow,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    community.cadence,
                    style: VibeMatchTextStyles.caption,
                  ),
                ),
              ],
            ),
          ],
          if (community.hostName.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(
                  Icons.person_rounded,
                  size: 15,
                  color: VibeMatchColors.textLow,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Conduzida por ${community.hostName}',
                    style: VibeMatchTextStyles.caption,
                  ),
                ),
              ],
            ),
          ],
          if (community.focusTopics.isNotEmpty) ...[
            const SizedBox(height: 16),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: community.focusTopics
                  .map((topic) => VibeTag(label: topic))
                  .toList(),
            ),
          ],
          const Divider(color: VibeMatchColors.border, height: 30),
          if (community.isMember)
            Row(
              children: [
                VibeTag(
                  label: 'Você é membro',
                  color: VibeMatchColors.positive,
                  filled: true,
                  icon: Icons.check_rounded,
                ),
                const Spacer(),
                Text(
                  'Ver membros',
                  style: VibeMatchTextStyles.caption.copyWith(
                    color: VibeMatchColors.neonPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            )
          else
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        fee == null ? 'Sob convite' : '$fee/mês',
                        style: VibeMatchTextStyles.subheading.copyWith(
                          fontSize: 17,
                        ),
                      ),
                      // The card stays visible when the person can't join —
                      // the requirement is the point of the tier, not a
                      // reason to hide it.
                      if (!community.eligible) ...[
                        const SizedBox(height: 6),
                        Text(
                          'Requer K-Score ${formatScore(community.minKScore)}',
                          style: VibeMatchTextStyles.caption.copyWith(
                            color: VibeMatchColors.negative,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                ElevatedButton(
                  onPressed: !community.eligible || busy ? null : onApply,
                  child: busy
                      ? const SizedBox(
                          height: 16,
                          width: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Solicitar vaga'),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _SeatsBar extends StatelessWidget {
  const _SeatsBar({required this.community});

  final Community community;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              community.seatsAvailable == 0
                  ? 'Turma completa'
                  : '${community.seatsAvailable} '
                      '${community.seatsAvailable == 1 ? 'vaga' : 'vagas'} '
                      'disponíveis',
              style: VibeMatchTextStyles.caption.copyWith(
                color: VibeMatchColors.textHigh,
                fontWeight: FontWeight.w700,
              ),
            ),
            const Spacer(),
            if (community.seatLimit > 0)
              Text(
                '${community.seatsTaken}/${community.seatLimit} assentos',
                style: VibeMatchTextStyles.caption,
              ),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: VibeMatchRadii.pillRadius,
          child: LinearProgressIndicator(
            value: community.seatsFilledFraction,
            minHeight: 6,
            backgroundColor: VibeMatchColors.slate,
            valueColor: const AlwaysStoppedAnimation<Color>(
              VibeMatchColors.neonPrimary,
            ),
          ),
        ),
      ],
    );
  }
}

/// Who is already in the room. Loaded on demand from
/// GET /communities/:communityId, because the list endpoint deliberately does
/// not carry every member of every community.
class _CommunityMembersSheet extends StatefulWidget {
  const _CommunityMembersSheet({
    required this.community,
    required this.repository,
  });

  final Community community;
  final CommunityRepository repository;

  @override
  State<_CommunityMembersSheet> createState() => _CommunityMembersSheetState();
}

class _CommunityMembersSheetState extends State<_CommunityMembersSheet> {
  late Future<CommunityDetail> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.repository.getCommunity(widget.community.id);
  }

  void _retry() {
    setState(() {
      _future = widget.repository.getCommunity(widget.community.id);
    });
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.8,
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 20, 22, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.community.tierLabel.toUpperCase(),
                style: VibeMatchTextStyles.eyebrow,
              ),
              const SizedBox(height: 8),
              Text(
                widget.community.name,
                style: VibeMatchTextStyles.sectionTitle,
              ),
              const SizedBox(height: 16),
              Flexible(
                child: FutureBuilder<CommunityDetail>(
                  future: _future,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Padding(
                        padding: EdgeInsets.symmetric(vertical: 40),
                        child: Center(
                          child: CircularProgressIndicator(
                            color: VibeMatchColors.neonPrimary,
                          ),
                        ),
                      );
                    }
                    if (snapshot.hasError) {
                      return VibeErrorState(
                        message: describeApiError(
                          snapshot.error!,
                          fallback:
                              'Não foi possível carregar os membros desta '
                              'comunidade.',
                        ),
                        onRetry: _retry,
                      );
                    }
                    final members = snapshot.data?.members ?? const [];
                    if (members.isEmpty) {
                      return const VibeEmptyState(
                        icon: Icons.groups_rounded,
                        title: 'Turma ainda sendo formada',
                        message: 'Os membros aparecem aqui conforme as vagas '
                            'são confirmadas.',
                      );
                    }
                    return ListView.separated(
                      shrinkWrap: true,
                      itemCount: members.length,
                      separatorBuilder: (_, __) => const Divider(
                        color: VibeMatchColors.border,
                        height: 22,
                      ),
                      itemBuilder: (context, index) {
                        final member = members[index];
                        return Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    member.name,
                                    style: VibeMatchTextStyles.subheading,
                                  ),
                                  if (member.headline.isNotEmpty) ...[
                                    const SizedBox(height: 3),
                                    Text(
                                      member.headline,
                                      style: VibeMatchTextStyles.caption,
                                    ),
                                  ],
                                  if (member.skills.isNotEmpty) ...[
                                    const SizedBox(height: 8),
                                    Wrap(
                                      spacing: 6,
                                      runSpacing: 6,
                                      children: member.skills
                                          .take(3)
                                          .map((s) => VibeTag(label: s))
                                          .toList(),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            const SizedBox(width: 14),
                            VibeStat(
                              value: formatScore(member.contributionScore),
                              caption: 'contrib.',
                              size: 24,
                            ),
                          ],
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
