import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../core/utils/vibe_format.dart';
import '../../data/repositories/escrow_repository.dart';
import '../widgets/vibe_ui.dart';

/// Turns a match into a supervised contract.
///
/// Everything on this screen exists to make one promise legible before the
/// user commits to a number: the amount is held by the platform and only
/// reaches the professional when the delivery is approved. That is the product,
/// so the screen says it in plain words rather than assuming it is understood.
///
/// Pops `true` when the project was created, so the caller can refresh its list.
class CreateDealScreen extends StatefulWidget {
  const CreateDealScreen({
    super.key,
    required this.escrowRepository,
    required this.matchId,
    required this.clientId,
    required this.providerId,
    this.counterpartName,
    this.initialCurrency = 'BRL',
  });

  final EscrowRepository escrowRepository;
  final String matchId;

  /// Who pays and who delivers. The server checks both against the match's two
  /// participants and rejects anything else, so these are decided by whoever
  /// opens this screen — not guessed here.
  final String clientId;
  final String providerId;

  /// Shown in the summary so the user can see who they are contracting.
  final String? counterpartName;
  final String initialCurrency;

  @override
  State<CreateDealScreen> createState() => _CreateDealScreenState();
}

class _CreateDealScreenState extends State<CreateDealScreen> {
  static const _currencies = ['BRL', 'USD'];

  final _formKey = GlobalKey<FormState>();
  final _budgetController = TextEditingController();

  late String _currency = _currencies.contains(widget.initialCurrency)
      ? widget.initialCurrency
      : _currencies.first;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Keeps the live preview under the field in sync with what is typed.
    _budgetController.addListener(_onBudgetChanged);
  }

  @override
  void dispose() {
    _budgetController
      ..removeListener(_onBudgetChanged)
      ..dispose();
    super.dispose();
  }

  void _onBudgetChanged() => setState(() {});

  /// Accepts both "1.500,00" and "1500.00" — people type Brazilian money the
  /// Brazilian way, and rejecting that would be the screen's fault, not theirs.
  static double? _parseAmount(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) return null;
    final normalized = trimmed.contains(',')
        ? trimmed.replaceAll('.', '').replaceAll(',', '.')
        : trimmed;
    return double.tryParse(normalized);
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final budget = _parseAmount(_budgetController.text);
    if (budget == null) return;

    // Captured before the await: the confirmation is shown after this route
    // pops, at which point this widget's own context is gone.
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.escrowRepository.create(
        matchId: widget.matchId,
        clientId: widget.clientId,
        providerId: widget.providerId,
        budget: budget,
        currency: _currency,
      );
      if (!mounted) return;
      navigator.pop(true);
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Contrato aberto. Deposite o valor para começar.'),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível abrir o contrato.',
        );
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = formatMoney(
      _parseAmount(_budgetController.text)?.toString(),
      _currency,
    );

    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Fechar negócio')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.only(
            top: 24,
            bottom: VibeMatchSpacing.sectionGap,
          ),
          children: [
            VibeContent(
              child: VibeSectionHeader(
                eyebrow: 'Custódia',
                title: 'Combine o valor,',
                titleAccent: 'a gente segura',
                subtitle: widget.counterpartName == null
                    ? null
                    : 'Contrato com ${widget.counterpartName}.',
              ),
            ),
            const SizedBox(height: 20),
            VibeContent(child: const _EscrowPromise()),
            const SizedBox(height: 24),
            VibeContent(
              child: TextFormField(
                controller: _budgetController,
                enabled: !_submitting,
                autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                style: VibeMatchTextStyles.body.copyWith(
                  color: VibeMatchColors.textHigh,
                  fontSize: 18,
                ),
                decoration: InputDecoration(
                  labelText: 'Valor do contrato',
                  hintText:
                      _currency == 'BRL' ? 'Ex.: 4.500,00' : 'Ex.: 900.00',
                  prefixText: _currency == 'BRL' ? r'R$ ' : r'$ ',
                  prefixStyle: VibeMatchTextStyles.body.copyWith(
                    color: VibeMatchColors.scoreGold,
                    fontSize: 18,
                  ),
                ),
                validator: (value) {
                  final amount = _parseAmount(value ?? '');
                  if (amount == null) return 'Informe o valor combinado.';
                  if (amount <= 0) return 'O valor precisa ser maior que zero.';
                  return null;
                },
              ),
            ),
            const SizedBox(height: 16),
            VibeContent(
              child: Row(
                children: [
                  Text('Moeda', style: VibeMatchTextStyles.caption),
                  const SizedBox(width: 12),
                  ..._currencies.map(
                    (code) => Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(code),
                        selected: _currency == code,
                        selectedColor:
                            VibeMatchColors.neonPrimary.withOpacity(0.18),
                        labelStyle: VibeMatchTextStyles.caption.copyWith(
                          color: _currency == code
                              ? VibeMatchColors.neonPrimary
                              : VibeMatchColors.textLow,
                          fontWeight: FontWeight.w700,
                        ),
                        onSelected: _submitting
                            ? null
                            : (_) => setState(() => _currency = code),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (preview != null) ...[
              const SizedBox(height: 20),
              VibeContent(
                child: VibeCard(
                  padding: const EdgeInsets.all(18),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.lock_rounded,
                        size: 18,
                        color: VibeMatchColors.scoreGold,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          '$preview ficam retidos até você aprovar a entrega.',
                          style: VibeMatchTextStyles.body.copyWith(
                            color: VibeMatchColors.textHigh,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 20),
              VibeContent(
                child: Text(
                  _error!,
                  style: VibeMatchTextStyles.body.copyWith(
                    color: VibeMatchColors.negative,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 28),
            VibeContent(
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Abrir contrato'),
                ),
              ),
            ),
            const SizedBox(height: 12),
            VibeContent(
              child: Text(
                'Abrir o contrato ainda não move dinheiro. O depósito é o '
                'passo seguinte, em Contratos.',
                textAlign: TextAlign.center,
                style: VibeMatchTextStyles.caption,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The product promise, stated once and plainly.
class _EscrowPromise extends StatelessWidget {
  const _EscrowPromise();

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      padding: const EdgeInsets.all(18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.shield_rounded,
            size: 20,
            color: VibeMatchColors.neonPrimary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'O valor fica retido pela plataforma e só é liberado para o '
              'profissional quando você aprovar a entrega.',
              style: VibeMatchTextStyles.body.copyWith(
                color: VibeMatchColors.textHigh,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
