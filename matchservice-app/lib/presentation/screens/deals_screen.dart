import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/models/escrow_models.dart';
import '../../data/repositories/escrow_repository.dart';
import '../widgets/vibe_ui.dart';

/// The contracts surface — the reason the platform exists.
///
/// A match is only an introduction. This is where the money actually sits: who
/// the deal is with, whether the amount is deposited, how far the milestones
/// have got, and the one or two moves each side is allowed to make right now.
///
/// Every action here is derived from `isClient` + `status` and mirrors what
/// `EscrowService` will accept, so the UI never offers a button the server is
/// going to reject:
///
/// | status    | client              | provider  |
/// |-----------|---------------------|-----------|
/// | PENDING   | depositar, cancelar | —         |
/// | FUNDED    | liberar, contestar  | contestar |
/// | everything else | —             | —         |
class DealsScreen extends StatefulWidget {
  const DealsScreen({super.key, required this.escrowRepository});

  final EscrowRepository escrowRepository;

  @override
  State<DealsScreen> createState() => _DealsScreenState();
}

class _DealsScreenState extends State<DealsScreen> {
  bool _loading = true;
  String? _error;
  List<EscrowProject> _projects = const [];

  /// Ids with a request in flight — their card's buttons go to a spinner
  /// instead of letting a double tap fire two state transitions.
  final _busyIds = <String>{};

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
      final projects = await widget.escrowRepository.listMine();
      if (!mounted) return;
      setState(() {
        _projects = projects;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível carregar seus contratos.',
        );
        _loading = false;
      });
    }
  }

  /// Silent refetch used after an action succeeds — the list must show the new
  /// status, but replacing the whole screen with a spinner for it would make a
  /// one-tap approval feel like a page reload.
  Future<void> _refresh() async {
    try {
      final projects = await widget.escrowRepository.listMine();
      if (!mounted) return;
      setState(() => _projects = projects);
    } catch (_) {
      // The action itself already succeeded; a failed refresh is not worth an
      // error screen. Pull-to-refresh remains available.
    }
  }

  void _notify(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _run(
    EscrowProject project,
    Future<void> Function() action, {
    required String successMessage,
    required String errorFallback,
  }) async {
    setState(() => _busyIds.add(project.id));
    try {
      await action();
      if (!mounted) return;
      _notify(successMessage);
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      _notify(describeApiError(error, fallback: errorFallback));
    } finally {
      if (mounted) setState(() => _busyIds.remove(project.id));
    }
  }

  /// Deposit. The endpoint currently settles the transfer itself; when it
  /// starts handing back a Stripe checkout session instead, the URL is opened
  /// and the list is refreshed on return.
  Future<void> _fund(EscrowProject project) async {
    setState(() => _busyIds.add(project.id));
    try {
      final checkoutUrl = await widget.escrowRepository.fund(project.id);
      if (!mounted) return;
      if (checkoutUrl == null) {
        _notify('Depósito registrado. O valor está em custódia.');
      } else {
        final uri = Uri.tryParse(checkoutUrl);
        final launched = uri != null &&
            await launchUrl(uri, mode: LaunchMode.externalApplication);
        if (!mounted) return;
        _notify(
          launched
              ? 'Conclua o pagamento na página que abriu.'
              : 'Não foi possível abrir a página de pagamento.',
        );
      }
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      _notify(
        describeApiError(
          error,
          fallback: 'Não foi possível depositar o valor deste contrato.',
        ),
      );
    } finally {
      if (mounted) setState(() => _busyIds.remove(project.id));
    }
  }

  Future<void> _complete(EscrowProject project) async {
    final confirmed = await _confirm(
      title: 'Liberar o pagamento?',
      message: 'O valor sai da custódia e vai para '
          '${project.counterpartName} agora. Depois disso não há como '
          'reverter pela plataforma — só libere se a entrega já estiver '
          'aprovada.',
      confirmLabel: 'Liberar pagamento',
    );
    if (!confirmed) return;
    await _run(
      project,
      () => widget.escrowRepository.complete(project.id),
      successMessage: 'Pagamento liberado.',
      errorFallback: 'Não foi possível liberar o pagamento.',
    );
  }

  Future<void> _dispute(EscrowProject project) async {
    final confirmed = await _confirm(
      title: 'Abrir disputa?',
      message: 'O valor fica congelado na custódia até a nossa análise '
          'terminar. Nem você nem ${project.counterpartName} conseguem mover '
          'o contrato enquanto a disputa estiver aberta.',
      confirmLabel: 'Abrir disputa',
      destructive: true,
    );
    if (!confirmed) return;
    await _run(
      project,
      () => widget.escrowRepository.dispute(project.id),
      successMessage: 'Disputa aberta. Nossa equipe vai analisar.',
      errorFallback: 'Não foi possível abrir a disputa.',
    );
  }

  Future<void> _cancel(EscrowProject project) async {
    final confirmed = await _confirm(
      title: 'Cancelar o contrato?',
      message: 'O contrato com ${project.counterpartName} é encerrado. Como '
          'nada foi depositado ainda, nenhum valor é movimentado — mas o '
          'contrato não pode ser reaberto: seria preciso criar outro.',
      confirmLabel: 'Cancelar contrato',
      destructive: true,
    );
    if (!confirmed) return;
    await _run(
      project,
      () => widget.escrowRepository.cancel(project.id),
      successMessage: 'Contrato cancelado.',
      errorFallback: 'Não foi possível cancelar o contrato.',
    );
  }

  Future<bool> _confirm({
    required String title,
    required String message,
    required String confirmLabel,
    bool destructive = false,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: VibeMatchColors.surface,
        title: Text(title, style: VibeMatchTextStyles.subheading),
        content: Text(message, style: VibeMatchTextStyles.body),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Voltar'),
          ),
          ElevatedButton(
            style: destructive
                ? ElevatedButton.styleFrom(
                    backgroundColor: VibeMatchColors.negative,
                    foregroundColor: VibeMatchColors.textHigh,
                  )
                : null,
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Contratos')),
      body: RefreshIndicator(
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
            else if (_projects.isEmpty)
              const VibeEmptyState(
                icon: Icons.handshake_outlined,
                title: 'Nenhum contrato ainda',
                message:
                    'Um match é só a apresentação. Quando você e a outra pessoa '
                    'combinarem escopo e valor, o contrato abre aqui — com o '
                    'dinheiro retido pela plataforma até a entrega ser aprovada.',
              )
            else ...[
              VibeContent(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 18),
                  child: VibeSectionHeader(
                    eyebrow: 'Custódia',
                    title: 'Seus',
                    titleAccent: 'contratos',
                    subtitle:
                        'O valor de cada contrato fica com a plataforma até a '
                        'entrega ser aprovada.',
                  ),
                ),
              ),
              ..._projects.map(
                (project) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: VibeContent(
                    child: _DealCard(
                      project: project,
                      busy: _busyIds.contains(project.id),
                      onFund: () => _fund(project),
                      onComplete: () => _complete(project),
                      onDispute: () => _dispute(project),
                      onCancel: () => _cancel(project),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DealCard extends StatelessWidget {
  const _DealCard({
    required this.project,
    required this.busy,
    required this.onFund,
    required this.onComplete,
    required this.onDispute,
    required this.onCancel,
  });

  final EscrowProject project;
  final bool busy;
  final VoidCallback onFund;
  final VoidCallback onComplete;
  final VoidCallback onDispute;
  final VoidCallback onCancel;

  /// Only what the server would actually accept from this side, in this state.
  List<Widget> _actions() {
    final isPending = project.status == EscrowStatus.pending;
    final isFunded = project.status == EscrowStatus.funded;

    return [
      // Only the client deposits, and only before anything has moved.
      if (project.isClient && isPending)
        _DealButton(
          label: 'Depositar valor',
          onPressed: onFund,
          busy: busy,
          primary: true,
        ),
      // Only the client releases custody.
      if (project.isClient && isFunded)
        _DealButton(
          label: 'Liberar pagamento',
          onPressed: onComplete,
          busy: busy,
          primary: true,
        ),
      // Either side can freeze a funded project.
      if (isFunded)
        _DealButton(label: 'Contestar', onPressed: onDispute, busy: busy),
      // Cancelling is the client's call and only while nothing is deposited.
      if (project.isClient && isPending)
        _DealButton(label: 'Cancelar', onPressed: onCancel, busy: busy),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final actions = _actions();
    final budget = formatMoney(project.budget.toString(), project.currency);

    return VibeCard(
      padding: const EdgeInsets.all(18),
      highlighted: project.status == EscrowStatus.disputed,
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
                      project.counterpartName,
                      style: VibeMatchTextStyles.cardTitle.copyWith(
                        fontSize: 18,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      project.isClient
                          ? 'Você contratou • aberto em '
                              '${formatFullDate(project.createdAt)}'
                          : 'Você entrega • aberto em '
                              '${formatFullDate(project.createdAt)}',
                      style: VibeMatchTextStyles.caption,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              VibeTag(
                label: project.status.label,
                color: project.status.color,
              ),
            ],
          ),
          const SizedBox(height: 14),
          // The status word alone does not tell anyone whether their money is
          // at risk — the plain-language reading of it is the point of the card.
          Text(project.status.explanation, style: VibeMatchTextStyles.body),
          const Divider(color: VibeMatchColors.border, height: 28),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Valor do contrato',
                        style: VibeMatchTextStyles.caption),
                    const SizedBox(height: 4),
                    Text(
                      budget ?? 'Valor a combinar',
                      style: VibeMatchTextStyles.subheading.copyWith(
                        fontSize: 20,
                        color: VibeMatchColors.scoreGold,
                      ),
                    ),
                  ],
                ),
              ),
              if (project.isFinanced || project.advanced)
                Expanded(
                  child: Wrap(
                    alignment: WrapAlignment.end,
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (project.isFinanced)
                        VibeTag(
                          label: project.installmentCount == null
                              ? 'Parcelado'
                              : 'Parcelado em ${project.installmentCount}x',
                          icon: Icons.credit_card_rounded,
                        ),
                      if (project.advanced)
                        const VibeTag(
                          label: 'Antecipado',
                          color: VibeMatchColors.textLow,
                          icon: Icons.bolt_rounded,
                        ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 16),
          _MilestoneProgress(project: project),
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 18),
            Wrap(spacing: 10, runSpacing: 10, children: actions),
          ],
        ],
      ),
    );
  }
}

/// Approved-of-total milestones plus the bar. A project with no milestones
/// defined says so rather than rendering an empty 0/0 track that reads as a
/// stalled deal.
class _MilestoneProgress extends StatelessWidget {
  const _MilestoneProgress({required this.project});

  final EscrowProject project;

  @override
  Widget build(BuildContext context) {
    if (project.milestoneTotal == 0) {
      return Text(
        'Nenhuma etapa definida ainda.',
        style: VibeMatchTextStyles.caption,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child:
                  Text('Etapas aprovadas', style: VibeMatchTextStyles.caption),
            ),
            Text(
              '${project.milestoneApproved}/${project.milestoneTotal}',
              style: VibeMatchTextStyles.caption.copyWith(
                color: VibeMatchColors.textHigh,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: VibeMatchRadii.pillRadius,
          child: LinearProgressIndicator(
            value: project.progress,
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

class _DealButton extends StatelessWidget {
  const _DealButton({
    required this.label,
    required this.onPressed,
    required this.busy,
    this.primary = false,
  });

  final String label;
  final VoidCallback onPressed;
  final bool busy;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final child = busy
        ? const SizedBox(
            height: 16,
            width: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : Text(label);
    final handler = busy ? null : onPressed;

    return primary
        ? ElevatedButton(onPressed: handler, child: child)
        : OutlinedButton(onPressed: handler, child: child);
  }
}
