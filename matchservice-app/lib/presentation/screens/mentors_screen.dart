import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/dio_client.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/models/academy_models.dart';
import '../../data/models/community_models.dart';
import '../../data/models/mastermind_models.dart';
import '../../data/models/mentor_models.dart';
import '../../data/models/mentorship_models.dart';
import '../../data/repositories/academy_repository.dart';
import '../../data/repositories/community_repository.dart';
import '../../data/repositories/mastermind_repository.dart';
import '../../data/repositories/mentorship_repository.dart';
import '../widgets/vibe_ui.dart';

/// The "people" half of the platform: the mentors who teach, the one-to-one
/// sessions they sell, the live sessions they run, and the paid communities
/// they host. Four tabs rather than four screens because the decision a member
/// is making — who do I learn from, and in what format — is a single one.
class MentorsScreen extends StatefulWidget {
  const MentorsScreen({
    super.key,
    required this.academyRepository,
    required this.mastermindRepository,
    required this.communityRepository,
    this.mentorshipRepository,
  });

  final AcademyRepository academyRepository;
  final MastermindRepository mastermindRepository;
  final CommunityRepository communityRepository;

  /// Optional so the existing call sites keep compiling untouched. When it is
  /// not supplied the tab builds one over the app-wide [DioClient], which is
  /// already provided — a `MentorshipRepository` is a stateless wrapper, so
  /// either route behaves identically.
  final MentorshipRepository? mentorshipRepository;

  @override
  State<MentorsScreen> createState() => _MentorsScreenState();
}

class _MentorsScreenState extends State<MentorsScreen> {
  late final MentorshipRepository _mentorshipRepository =
      widget.mentorshipRepository ??
          MentorshipRepository(context.read<DioClient>());

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
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
              Tab(text: '1:1'),
              Tab(text: 'Ao vivo'),
              Tab(text: 'Comunidades'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _MentorsTab(repository: widget.academyRepository),
            _OneToOneTab(repository: _mentorshipRepository),
            _LiveTab(repository: widget.mastermindRepository),
            _CommunitiesTab(repository: widget.communityRepository),
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
// 1:1
// ---------------------------------------------------------------------------

/// Which half of the one-to-one tab is on screen.
enum _OneToOneView { offerings, bookings }

/// Paid one-to-one sessions: the catalogue of what mentors have opened, and
/// the sessions the member already has — on both sides, because a mentor here
/// is usually also somebody else's mentee.
class _OneToOneTab extends StatefulWidget {
  const _OneToOneTab({required this.repository});

  final MentorshipRepository repository;

  @override
  State<_OneToOneTab> createState() => _OneToOneTabState();
}

class _OneToOneTabState extends State<_OneToOneTab>
    with AutomaticKeepAliveClientMixin {
  final _searchController = TextEditingController();

  _OneToOneView _view = _OneToOneView.offerings;

  Timer? _debounce;

  bool _offeringsLoading = true;
  String? _offeringsError;
  MentorshipOfferingPage? _page;

  bool _bookingsLoading = false;
  bool _bookingsLoaded = false;
  String? _bookingsError;
  MentorshipBookings? _bookings;

  /// Slot ids with a checkout request in flight — the card's confirm button
  /// spins instead of letting a double tap open two checkouts.
  final _bookingSlotIds = <String>{};

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _loadOfferings();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadOfferings() async {
    setState(() {
      _offeringsLoading = true;
      _offeringsError = null;
    });
    try {
      final page = await widget.repository.listOfferings(
        search: _searchController.text,
      );
      if (!mounted) return;
      setState(() {
        _page = page;
        _offeringsLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _offeringsError = describeApiError(
          error,
          fallback: 'Não foi possível carregar as mentorias individuais.',
        );
        _offeringsLoading = false;
      });
    }
  }

  Future<void> _loadBookings() async {
    setState(() {
      _bookingsLoading = true;
      _bookingsError = null;
    });
    try {
      final bookings = await widget.repository.listBookings();
      if (!mounted) return;
      setState(() {
        _bookings = bookings;
        _bookingsLoaded = true;
        _bookingsLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _bookingsError = describeApiError(
          error,
          fallback: 'Não foi possível carregar suas sessões.',
        );
        _bookingsLoaded = true;
        _bookingsLoading = false;
      });
    }
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _loadOfferings);
  }

  void _switchTo(_OneToOneView view) {
    setState(() => _view = view);
    // Fetched the first time the view is opened rather than on tab load — most
    // people come here to browse, not to check a session they already booked.
    if (view == _OneToOneView.bookings && !_bookingsLoaded) _loadBookings();
  }

  void _notify(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  /// Confirm, then hand off to checkout. Same contract as the masterminds: the
  /// booking only exists once the payment webhook confirms it, so this opens
  /// the URL and says so rather than claiming the session is booked.
  Future<void> _book(MentorshipOffering offering, MentorshipSlot slot) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: VibeMatchColors.surface,
        title: Text('Confirmar sessão', style: VibeMatchTextStyles.subheading),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(offering.title, style: VibeMatchTextStyles.cardTitle),
            const SizedBox(height: 8),
            Text(
              'com ${offering.mentorName}',
              style: VibeMatchTextStyles.body,
            ),
            const SizedBox(height: 14),
            _ConfirmLine(
              icon: Icons.event_rounded,
              label: slot.startsAt == null
                  ? 'Horário a confirmar'
                  : formatShortDateTime(slot.startsAt!),
            ),
            _ConfirmLine(
              icon: Icons.schedule_rounded,
              label: _formatDuration(offering.durationMinutes),
            ),
            _ConfirmLine(
              icon: Icons.payments_rounded,
              label: formatMoney(offering.price, offering.currency) ??
                  'Valor a combinar',
            ),
            const SizedBox(height: 14),
            Text(
              'Você será levado ao pagamento. A sessão só fica reservada '
              'depois que o pagamento for confirmado.',
              style: VibeMatchTextStyles.caption,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Voltar'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Ir para o pagamento'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _bookingSlotIds.add(slot.id));
    try {
      final checkoutUrl = await widget.repository.book(slot.id);
      if (!mounted) return;
      if (checkoutUrl == null || checkoutUrl.isEmpty) {
        _notify('O checkout desta sessão não está disponível agora.');
        return;
      }
      final uri = Uri.tryParse(checkoutUrl);
      final launched = uri != null &&
          await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched) {
        _notify('Não foi possível abrir a página de pagamento.');
        return;
      }
      // The slot is gone from the catalogue once someone pays for it, and the
      // session shows up under "Minhas sessões" — both need a refetch.
      if (mounted) {
        _bookingsLoaded = false;
        await _loadOfferings();
      }
    } catch (error) {
      if (!mounted) return;
      _notify(
        describeApiError(
          error,
          fallback: 'Não foi possível reservar este horário.',
        ),
      );
    } finally {
      if (mounted) setState(() => _bookingSlotIds.remove(slot.id));
    }
  }

  Future<void> _openMeeting(MenteeBooking booking) async {
    final uri = Uri.tryParse(booking.meetingUrl ?? '');
    final launched = uri != null &&
        await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched) _notify('Não foi possível abrir a sala da sessão.');
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 16, bottom: 4),
          child: VibeContent(
            child: _ViewToggle(
              view: _view,
              onChanged: _switchTo,
            ),
          ),
        ),
        Expanded(
          child: _view == _OneToOneView.offerings
              ? _buildOfferings()
              : _buildBookings(),
        ),
      ],
    );
  }

  Widget _buildOfferings() {
    final offerings = _page?.offerings ?? const <MentorshipOffering>[];

    return RefreshIndicator(
      onRefresh: _loadOfferings,
      color: VibeMatchColors.neonPrimary,
      backgroundColor: VibeMatchColors.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: VibeMatchSpacing.sectionGap),
        children: [
          VibeContent(
            child: Padding(
              padding: const EdgeInsets.only(top: 16, bottom: 18),
              child: TextField(
                controller: _searchController,
                onChanged: _onSearchChanged,
                onSubmitted: (_) => _loadOfferings(),
                textInputAction: TextInputAction.search,
                style: VibeMatchTextStyles.body.copyWith(
                  color: VibeMatchColors.textHigh,
                ),
                decoration: const InputDecoration(
                  hintText: 'Buscar por tema, mentor ou problema',
                  prefixIcon: Icon(
                    Icons.search_rounded,
                    color: VibeMatchColors.textLow,
                    size: 20,
                  ),
                ),
              ),
            ),
          ),
          if (_offeringsLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 56),
              child: Center(
                child: CircularProgressIndicator(
                  color: VibeMatchColors.neonPrimary,
                ),
              ),
            )
          else if (_offeringsError != null)
            VibeErrorState(message: _offeringsError!, onRetry: _loadOfferings)
          else if (offerings.isEmpty)
            VibeEmptyState(
              icon: Icons.record_voice_over_rounded,
              title: _searchController.text.trim().isEmpty
                  ? 'Nenhuma mentoria individual aberta'
                  : 'Nenhuma mentoria para essa busca',
              message: _searchController.text.trim().isEmpty
                  ? 'Quando um mentor abrir horários para conversas de uma '
                      'hora, elas aparecem aqui.'
                  : 'Tente outro tema, ou limpe a busca para ver tudo que '
                      'está aberto.',
              action: _searchController.text.trim().isEmpty
                  ? null
                  : OutlinedButton(
                      onPressed: () {
                        _searchController.clear();
                        _loadOfferings();
                      },
                      child: const Text('Limpar busca'),
                    ),
            )
          else
            ...offerings.map(
              (offering) => Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: VibeContent(
                  child: _OfferingCard(
                    offering: offering,
                    busySlotIds: _bookingSlotIds,
                    onBook: (slot) => _book(offering, slot),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildBookings() {
    final bookings = _bookings;

    if (_bookingsLoading) {
      return const Center(
        child: CircularProgressIndicator(color: VibeMatchColors.neonPrimary),
      );
    }
    if (_bookingsError != null) {
      return VibeErrorState(message: _bookingsError!, onRetry: _loadBookings);
    }
    if (bookings == null || bookings.isEmpty) {
      return RefreshIndicator(
        onRefresh: _loadBookings,
        color: VibeMatchColors.neonPrimary,
        backgroundColor: VibeMatchColors.surface,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: const [
            SizedBox(height: 40),
            VibeEmptyState(
              icon: Icons.event_note_rounded,
              title: 'Nenhuma sessão marcada',
              message: 'As conversas que você reservar — e as que marcarem com '
                  'você — ficam listadas aqui, com o link da sala.',
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadBookings,
      color: VibeMatchColors.neonPrimary,
      backgroundColor: VibeMatchColors.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(
          top: 18,
          bottom: VibeMatchSpacing.sectionGap,
        ),
        children: [
          if (bookings.asMentee.isNotEmpty) ...[
            VibeContent(
              child: VibeSectionHeader(
                eyebrow: 'Como mentorado',
                title: 'Suas conversas',
                titleAccent: 'marcadas',
                subtitle: '${bookings.asMentee.length} '
                    '${bookings.asMentee.length == 1 ? 'sessão' : 'sessões'} '
                    'com mentores.',
              ),
            ),
            const SizedBox(height: 16),
            ...bookings.asMentee.map(
              (booking) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: VibeContent(
                  child: _MenteeBookingCard(
                    booking: booking,
                    onJoin: () => _openMeeting(booking),
                  ),
                ),
              ),
            ),
          ],
          if (bookings.asMentor.isNotEmpty) ...[
            SizedBox(height: bookings.asMentee.isEmpty ? 0 : 28),
            VibeContent(
              child: VibeSectionHeader(
                eyebrow: 'Como mentor',
                title: 'Quem marcou',
                titleAccent: 'com você',
                subtitle: '${bookings.asMentor.length} '
                    '${bookings.asMentor.length == 1 ? 'pessoa' : 'pessoas'} '
                    'na sua agenda.',
              ),
            ),
            const SizedBox(height: 16),
            ...bookings.asMentor.map(
              (booking) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: VibeContent(
                  child: _MentorBookingCard(booking: booking),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// "60 min" / "1h30" — a session length reads as a commitment, so it is spelled
/// out rather than left as a bare number of minutes.
String _formatDuration(int minutes) {
  if (minutes <= 0) return 'Duração a combinar';
  if (minutes < 60) return '$minutes min';
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  if (rest == 0) return '${hours}h';
  return '${hours}h${rest.toString().padLeft(2, '0')}';
}

class _ViewToggle extends StatelessWidget {
  const _ViewToggle({required this.view, required this.onChanged});

  final _OneToOneView view;
  final ValueChanged<_OneToOneView> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: VibeMatchColors.surface,
        borderRadius: VibeMatchRadii.pillRadius,
        border: Border.all(color: VibeMatchColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: _ViewToggleButton(
              label: 'Ofertas',
              selected: view == _OneToOneView.offerings,
              onTap: () => onChanged(_OneToOneView.offerings),
            ),
          ),
          Expanded(
            child: _ViewToggleButton(
              label: 'Minhas sessões',
              selected: view == _OneToOneView.bookings,
              onTap: () => onChanged(_OneToOneView.bookings),
            ),
          ),
        ],
      ),
    );
  }
}

class _ViewToggleButton extends StatelessWidget {
  const _ViewToggleButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? VibeMatchColors.neonPrimary : Colors.transparent,
      borderRadius: VibeMatchRadii.pillRadius,
      child: InkWell(
        onTap: onTap,
        borderRadius: VibeMatchRadii.pillRadius,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: VibeMatchTextStyles.button.copyWith(
              color: selected ? VibeMatchColors.ink : VibeMatchColors.textLow,
            ),
          ),
        ),
      ),
    );
  }
}

class _ConfirmLine extends StatelessWidget {
  const _ConfirmLine({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Icon(icon, size: 15, color: VibeMatchColors.textLow),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: VibeMatchTextStyles.caption.copyWith(
                color: VibeMatchColors.textHigh,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One published session. The slot chips are part of the card rather than a
/// separate sheet: choosing the time is the decision, and hiding it behind
/// another tap is what makes booking flows feel long.
class _OfferingCard extends StatefulWidget {
  const _OfferingCard({
    required this.offering,
    required this.busySlotIds,
    required this.onBook,
  });

  final MentorshipOffering offering;
  final Set<String> busySlotIds;
  final ValueChanged<MentorshipSlot> onBook;

  @override
  State<_OfferingCard> createState() => _OfferingCardState();
}

class _OfferingCardState extends State<_OfferingCard> {
  String? _selectedSlotId;

  MentorshipSlot? get _selectedSlot {
    for (final slot in widget.offering.nextSlots) {
      if (slot.id == _selectedSlotId) return slot;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final offering = widget.offering;
    final price = formatMoney(offering.price, offering.currency);
    final selected = _selectedSlot;
    final busy = selected != null && widget.busySlotIds.contains(selected.id);

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
                      offering.mentorName.isEmpty
                          ? 'Mentor'
                          : offering.mentorName,
                      style: VibeMatchTextStyles.subheading,
                    ),
                    if (offering.mentorHeadline.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        offering.mentorHeadline,
                        style: VibeMatchTextStyles.caption,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              if (offering.kScore > 0) ...[
                const SizedBox(width: 16),
                VibeStat(
                  value: formatScore(offering.kScore),
                  caption: 'K-Score',
                  size: 26,
                ),
              ],
            ],
          ),
          const SizedBox(height: 16),
          Text(offering.title, style: VibeMatchTextStyles.sectionTitle),
          if (offering.description.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              offering.description,
              style: VibeMatchTextStyles.body,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 14),
          Wrap(
            spacing: 16,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _MentorMeta(
                icon: Icons.schedule_rounded,
                label: _formatDuration(offering.durationMinutes),
              ),
              Text(
                price ?? 'Valor a combinar',
                style: VibeMatchTextStyles.subheading.copyWith(
                  color: VibeMatchColors.scoreGold,
                ),
              ),
            ],
          ),
          if (offering.topics.isNotEmpty) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: offering.topics
                  .take(5)
                  .map((topic) => VibeTag(label: topic))
                  .toList(),
            ),
          ],
          const Divider(color: VibeMatchColors.border, height: 28),
          if (!offering.hasSlots)
            Row(
              children: [
                const Icon(
                  Icons.event_busy_rounded,
                  size: 15,
                  color: VibeMatchColors.textLow,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Sem horários abertos no momento. O mentor libera novas '
                    'datas por temporada.',
                    style: VibeMatchTextStyles.caption,
                  ),
                ),
              ],
            )
          else ...[
            Text(
              'Escolha um horário',
              style: VibeMatchTextStyles.caption.copyWith(
                color: VibeMatchColors.textHigh,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: offering.nextSlots
                  .map(
                    (slot) => _SlotChip(
                      slot: slot,
                      selected: slot.id == _selectedSlotId,
                      onTap: () => setState(
                        () => _selectedSlotId =
                            slot.id == _selectedSlotId ? null : slot.id,
                      ),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: selected == null || busy
                    ? null
                    : () => widget.onBook(selected),
                child: busy
                    ? const SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        selected == null
                            ? 'Selecione um horário'
                            : 'Reservar e pagar',
                      ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SlotChip extends StatelessWidget {
  const _SlotChip({
    required this.slot,
    required this.selected,
    required this.onTap,
  });

  final MentorshipSlot slot;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected
          ? VibeMatchColors.neonPrimary.withOpacity(0.18)
          : VibeMatchColors.slate.withOpacity(0.45),
      borderRadius: VibeMatchRadii.pillRadius,
      child: InkWell(
        onTap: onTap,
        borderRadius: VibeMatchRadii.pillRadius,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            borderRadius: VibeMatchRadii.pillRadius,
            border: Border.all(
              color: selected
                  ? VibeMatchColors.neonPrimary
                  : VibeMatchColors.border,
              width: selected ? 1.4 : 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                selected ? Icons.check_circle_rounded : Icons.schedule_rounded,
                size: 14,
                color: selected
                    ? VibeMatchColors.neonPrimary
                    : VibeMatchColors.textLow,
              ),
              const SizedBox(width: 6),
              Text(
                slot.startsAt == null
                    ? 'Horário a confirmar'
                    : formatShortDateTime(slot.startsAt!),
                style: VibeMatchTextStyles.caption.copyWith(
                  color: selected
                      ? VibeMatchColors.textHigh
                      : VibeMatchColors.textLow,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MenteeBookingCard extends StatelessWidget {
  const _MenteeBookingCard({required this.booking, required this.onJoin});

  final MenteeBooking booking;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    final paid = formatMoney(booking.pricePaid, booking.currency);

    return VibeCard(
      padding: const EdgeInsets.all(18),
      highlighted: booking.isConfirmed && booking.hasMeetingUrl,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  booking.startsAt == null
                      ? 'Horário a confirmar'
                      : formatShortDateTime(booking.startsAt!),
                  style: VibeMatchTextStyles.caption.copyWith(
                    color: VibeMatchColors.scoreGold,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              _StatusTag(status: booking.status, label: booking.statusLabel),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            booking.offeringTitle.isEmpty
                ? 'Mentoria individual'
                : booking.offeringTitle,
            style: VibeMatchTextStyles.cardTitle.copyWith(fontSize: 17),
          ),
          const SizedBox(height: 5),
          Text(
            'com ${booking.mentorName.isEmpty ? 'mentor a confirmar' : booking.mentorName}',
            style: VibeMatchTextStyles.body,
          ),
          if (paid != null) ...[
            const SizedBox(height: 8),
            Text('Pago: $paid', style: VibeMatchTextStyles.caption),
          ],
          const Divider(color: VibeMatchColors.border, height: 28),
          if (booking.hasMeetingUrl)
            Row(
              children: [
                Expanded(
                  child: Text(
                    'A sala já está publicada.',
                    style: VibeMatchTextStyles.caption,
                  ),
                ),
                const SizedBox(width: 12),
                ElevatedButton(
                  onPressed: onJoin,
                  child: const Text('Entrar na sala'),
                ),
              ],
            )
          else
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 1),
                  child: Icon(
                    Icons.link_off_rounded,
                    size: 15,
                    color: VibeMatchColors.textLow,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'O mentor ainda não publicou o link da sala. Ele aparece '
                    'aqui assim que for criado.',
                    style: VibeMatchTextStyles.caption,
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _MentorBookingCard extends StatelessWidget {
  const _MentorBookingCard({required this.booking});

  final MentorBooking booking;

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  booking.startsAt == null
                      ? 'Horário a confirmar'
                      : formatShortDateTime(booking.startsAt!),
                  style: VibeMatchTextStyles.caption.copyWith(
                    color: VibeMatchColors.scoreGold,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              _StatusTag(status: booking.status, label: booking.statusLabel),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            booking.offeringTitle.isEmpty
                ? 'Mentoria individual'
                : booking.offeringTitle,
            style: VibeMatchTextStyles.cardTitle.copyWith(fontSize: 17),
          ),
          const SizedBox(height: 5),
          Text(
            'com ${booking.menteeName.isEmpty ? 'mentorado a confirmar' : booking.menteeName}',
            style: VibeMatchTextStyles.body,
          ),
        ],
      ),
    );
  }
}

/// Status colour follows what the member can do about it: confirmed is green,
/// cancelled is red, everything else stays neutral gold.
class _StatusTag extends StatelessWidget {
  const _StatusTag({required this.status, required this.label});

  final String status;
  final String label;

  @override
  Widget build(BuildContext context) {
    final upper = status.toUpperCase();
    final color = upper == 'CONFIRMED' || upper == 'COMPLETED'
        ? VibeMatchColors.positive
        : upper == 'CANCELLED' || upper == 'CANCELED' || upper == 'NO_SHOW'
            ? VibeMatchColors.negative
            : VibeMatchColors.scoreGold;
    return VibeTag(
      label: label.isEmpty ? 'Sem status' : label,
      color: color,
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
