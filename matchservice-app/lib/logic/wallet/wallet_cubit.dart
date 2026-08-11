import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/utils/api_error.dart';
import '../../data/models/wallet_models.dart';
import '../../data/repositories/wallet_repository.dart';

/// Wallet dashboard state — named WalletCubit per this project's convention
/// (AuthCubit/SwipeCubit/FeedCubit/SubscriptionCubit all use Cubit, the
/// single-method specialization of Bloc from flutter_bloc). This is the
/// "WalletBloc" from spec: animated balance updates on advance/withdraw,
/// K-Score, BNPL credit line, and the installments/milestones timeline.
sealed class WalletState {
  const WalletState();
}

class WalletInitial extends WalletState {
  const WalletInitial();
}

class WalletLoading extends WalletState {
  const WalletLoading();
}

class WalletLoaded extends WalletState {
  const WalletLoaded({
    required this.balance,
    required this.currency,
    required this.kScore,
    required this.bnplCreditLimit,
    required this.timeline,
    this.actionPending = false,
  });

  final double balance;
  final String currency;
  final int kScore;
  final double bnplCreditLimit;
  final WalletTimeline timeline;
  final bool
      actionPending; // true mid advance/withdraw — drives the balance-update animation

  WalletLoaded copyWith({double? balance, bool? actionPending}) => WalletLoaded(
        balance: balance ?? this.balance,
        currency: currency,
        kScore: kScore,
        bnplCreditLimit: bnplCreditLimit,
        timeline: timeline,
        actionPending: actionPending ?? this.actionPending,
      );
}

class WalletError extends WalletState {
  const WalletError(this.message);
  final String message;
}

class WalletCubit extends Cubit<WalletState> {
  WalletCubit(this._repository) : super(const WalletInitial());

  final WalletRepository _repository;

  /// The dashboard as it stood before a failed action, so the error frame can
  /// be dismissed without refetching everything.
  WalletLoaded? _lastLoaded;

  /// Drops a `WalletError` and restores the dashboard behind it.
  ///
  /// The action failures below used to emit `WalletError` and then immediately
  /// re-emit the previous state in the same synchronous block, so no
  /// `BlocBuilder` could ever render the error frame — a rejected withdrawal
  /// looked like a no-op. The error state now persists, and the screen calls
  /// this once it has shown the message.
  ///
  /// A failed *initial* load has no dashboard to go back to, so the error is
  /// left in place: that one is a whole-screen failure with a retry, not a
  /// dismissible notice.
  void clearError() {
    if (state is! WalletError) return;
    final previous = _lastLoaded;
    if (previous == null) return;
    emit(previous);
  }

  Future<void> load({
    required double initialBalance,
    required String currency,
    required String userId,
  }) async {
    emit(const WalletLoading());
    try {
      final scoreJson = await _repository
          .getScore(userId)
          .catchError((_) => <String, dynamic>{});
      final timeline = await _repository.getTimeline();
      final kScore = (scoreJson['financialHealthScore'] as int?) ?? 500;

      // BNPL credit line: a simple function of K-Score until a dedicated
      // underwriting endpoint exists — mirrors the conservative first-time-
      // client cap bnpl.service.ts applies server-side (that server check is
      // still the source of truth; this is just a UI-facing estimate).
      final bnplCreditLimit = (kScore / 1000) * 20000;

      final loaded = WalletLoaded(
        balance: initialBalance,
        currency: currency,
        kScore: kScore,
        bnplCreditLimit: bnplCreditLimit,
        timeline: timeline,
      );
      _lastLoaded = loaded;
      emit(loaded);
    } catch (e) {
      _lastLoaded = null;
      emit(WalletError(describeApiError(e,
          fallback: 'Não foi possível '
              'carregar a carteira.')));
    }
  }

  Future<void> instantAdvance(String escrowId) async {
    final current = state;
    if (current is! WalletLoaded) return;
    emit(current.copyWith(actionPending: true));
    try {
      final result = await _repository.advance(escrowId);
      final newBalance =
          double.tryParse('${result['walletBalance']}') ?? current.balance;
      final settled = current.copyWith(
        balance: newBalance,
        actionPending: false,
      );
      _lastLoaded = settled;
      emit(settled);
    } catch (e) {
      // The error is the last state emitted, so the UI actually gets to render
      // it; `clearError()` puts this dashboard back afterwards.
      _lastLoaded = current.copyWith(actionPending: false);
      emit(
        WalletError(
          describeApiError(
            e,
            fallback: 'Não foi possível antecipar este recebível.',
          ),
        ),
      );
    }
  }

  Future<void> withdraw(double amount) async {
    final current = state;
    if (current is! WalletLoaded) return;
    emit(current.copyWith(actionPending: true));
    try {
      final result = await _repository.withdraw(amount);
      final newBalance = double.tryParse('${result['walletBalance']}') ??
          (current.balance - amount);
      final settled = current.copyWith(
        balance: newBalance,
        actionPending: false,
      );
      _lastLoaded = settled;
      emit(settled);
    } catch (e) {
      _lastLoaded = current.copyWith(actionPending: false);
      emit(
        WalletError(
          describeApiError(
            e,
            fallback: 'Não foi possível concluir o saque.',
          ),
        ),
      );
    }
  }
}
