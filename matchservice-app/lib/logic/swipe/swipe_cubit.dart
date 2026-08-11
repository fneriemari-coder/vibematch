import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
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

  /// Entered from DiscoveryFeedScreen's "Implementar no meu Negócio" CTA, in
  /// LOCAL mode when the post came from the local stream.
  ///
  /// [skillTagId] is the feed post's tag row id; the server resolves it to the
  /// tag name and keeps only providers who list that skill, so the deck the
  /// user lands on matches the post they came from. An unknown id degrades to
  /// the unfiltered deck rather than an empty one.
  Future<void> loadStackForTag({
    required String? skillTagId,
    SwipeMode mode = SwipeMode.cloud,
    double? lat,
    double? lng,
  }) =>
      loadStack(mode, lat: lat, lng: lng, skillTagId: skillTagId);

  Future<void> loadStack(
    SwipeMode mode, {
    double? lat,
    double? lng,
    String? skillTagId,
  }) async {
    emit(const SwipeLoading());
    try {
      final candidates = await _repository.getStack(
        mode: mode,
        skillTagId: skillTagId,
        lat: lat,
        lng: lng,
      );
      emit(SwipeStackLoaded(candidates, mode));
    } on DioException catch (e) {
      emit(SwipeError(_messageFor(e)));
    } catch (e) {
      // Anything that is not a transport failure — realistically a `TypeError`
      // out of `SwipeCandidate.fromJson` after a response-shape change. Without
      // this the exception escaped the cubit and left it in SwipeLoading
      // forever: an infinite spinner with no way back.
      emit(SwipeError(_unexpected(e)));
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
    } catch (e) {
      emit(SwipeError(_unexpected(e)));
    }
  }

  String _messageFor(DioException e) =>
      e.response?.data?['message']?.toString() ??
      e.message ??
      'Unexpected error';

  /// Fallback copy for a non-transport failure. Deliberately generic: the
  /// underlying `TypeError` text is meaningless to a user, and the point of
  /// this state is that the screen offers a way out instead of hanging.
  String _unexpected(Object e) {
    debugPrint('SwipeCubit: unexpected failure — $e');
    return 'Algo deu errado ao carregar. Tente de novo.';
  }
}
