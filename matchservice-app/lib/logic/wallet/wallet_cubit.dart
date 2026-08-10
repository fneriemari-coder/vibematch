import 'package:flutter_bloc/flutter_bloc.dart';
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
  final bool actionPending; // true mid advance/withdraw — drives the balance-update animation

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

  Future<void> load({
    required double initialBalance,
    required String currency,
    required String userId,
  }) async {
    emit(const WalletLoading());
    try {
      final scoreJson = await _repository.getScore(userId).catchError((_) => <String, dynamic>{});
      final timeline = await _repository.getTimeline();
      final kScore = (scoreJson['financialHealthScore'] as int?) ?? 500;

      // BNPL credit line: a simple function of K-Score until a dedicated
      // underwriting endpoint exists — mirrors the conservative first-time-
      // client cap bnpl.service.ts applies server-side (that server check is
      // still the source of truth; this is just a UI-facing estimate).
      final bnplCreditLimit = (kScore / 1000) * 20000;

      emit(WalletLoaded(
        balance: initialBalance,
        currency: currency,
        kScore: kScore,
        bnplCreditLimit: bnplCreditLimit,
        timeline: timeline,
      ));
    } catch (e) {
      emit(WalletError(e.toString()));
    }
  }

  Future<void> instantAdvance(String escrowId) async {
    final current = state;
    if (current is! WalletLoaded) return;
    emit(current.copyWith(actionPending: true));
    try {
      final result = await _repository.advance(escrowId);
      final newBalance = double.tryParse('${result['walletBalance']}') ?? current.balance;
      emit(current.copyWith(balance: newBalance, actionPending: false));
    } catch (e) {
      emit(current.copyWith(actionPending: false));
      emit(WalletError(e.toString()));
      emit(current);
    }
  }

  Future<void> withdraw(double amount) async {
    final current = state;
    if (current is! WalletLoaded) return;
    emit(current.copyWith(actionPending: true));
    try {
      final result = await _repository.withdraw(amount);
      final newBalance = double.tryParse('${result['walletBalance']}') ?? (current.balance - amount);
      emit(current.copyWith(balance: newBalance, actionPending: false));
    } catch (e) {
      emit(current.copyWith(actionPending: false));
      emit(WalletError(e.toString()));
      emit(current);
    }
  }
}
