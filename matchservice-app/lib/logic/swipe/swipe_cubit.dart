import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../data/models/feed_models.dart';
import '../../data/models/user_models.dart';
import '../../data/repositories/swipe_repository.dart';

sealed class SwipeState {
  const SwipeState();
}

class SwipeIdle extends SwipeState {
  const SwipeIdle();
}

class SwipeLoading extends SwipeState {
  const SwipeLoading();
}

class SwipeStackLoaded extends SwipeState {
  const SwipeStackLoaded(this.candidates, this.mode);
  final List<SwipeCandidate> candidates;
  final SwipeMode mode;
}

class SwipeMatchFound extends SwipeState {
  const SwipeMatchFound(this.matchId, this.otherUserName);
  final String matchId;
  final String otherUserName;
}

/// FREE-tier daily swipe cap hit — backend returned HTTP 402. UI should
/// route to PaywallScreen when it sees this state.
class SwipePaywallRequired extends SwipeState {
  const SwipePaywallRequired();
}

class SwipeError extends SwipeState {
  const SwipeError(this.message);
  final String message;
}

class SwipeCubit extends Cubit<SwipeState> {
  SwipeCubit(this._repository) : super(const SwipeIdle());

  final SwipeRepository _repository;

  /// Called by DiscoveryFeedScreen's "Implementar no meu Negócio" CTA —
  /// jumps straight into a filtered deck for one skill tag, entering LOCAL
  /// mode automatically when coordinates are supplied.
  Future<void> loadStackForTag({
    required String? skillTagId,
    SwipeMode mode = SwipeMode.cloud,
    double? lat,
    double? lng,
  }) async {
    emit(const SwipeLoading());
    try {
      final candidates = await _repository.getStack(
        mode: mode,
        lat: lat,
        lng: lng,
      );
      emit(SwipeStackLoaded(candidates, mode));
    } on DioException catch (e) {
      emit(SwipeError(_messageFor(e)));
    }
  }

  Future<void> loadStack(SwipeMode mode, {double? lat, double? lng}) async {
    emit(const SwipeLoading());
    try {
      final candidates = await _repository.getStack(
        mode: mode,
        lat: lat,
        lng: lng,
      );
      emit(SwipeStackLoaded(candidates, mode));
    } on DioException catch (e) {
      emit(SwipeError(_messageFor(e)));
    }
  }

  Future<void> swipe({
    required String swipedId,
    required bool like,
    required SwipeMode mode,
  }) async {
    try {
      final result = await _repository.swipe(
        swipedId: swipedId,
        like: like,
        mode: mode,
      );
      final match = result['match'];
      if (match != null) {
        emit(SwipeMatchFound(match['id'] as String, swipedId));
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 402) {
        emit(const SwipePaywallRequired());
        return;
      }
      emit(SwipeError(_messageFor(e)));
    }
  }

  String _messageFor(DioException e) =>
      e.response?.data?['message']?.toString() ??
      e.message ??
      'Unexpected error';
}
