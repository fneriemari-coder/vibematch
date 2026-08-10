import 'package:flutter_bloc/flutter_bloc.dart';
import '../../data/models/feed_models.dart';
import '../../data/repositories/feed_repository.dart';

sealed class FeedState {
  const FeedState();
}

class FeedInitial extends FeedState {
  const FeedInitial();
}

class FeedLoading extends FeedState {
  const FeedLoading(this.items);
  final List<DiscoveryFeedItem>
      items; // previous page, kept visible during infinite-scroll load
}

class FeedLoaded extends FeedState {
  const FeedLoaded(this.items, {this.hasMore = true});
  final List<DiscoveryFeedItem> items;
  final bool hasMore;
}

class FeedError extends FeedState {
  const FeedError(this.message);
  final String message;
}

/// "IA pensando" — the AI search bar is mid-request against /ai/translate.
class FeedAiThinking extends FeedState {
  const FeedAiThinking(this.items);
  final List<DiscoveryFeedItem> items;
}

class FeedAiResult extends FeedState {
  const FeedAiResult(this.result, this.items);
  final AiTranslateResult result;
  final List<DiscoveryFeedItem> items;
}

class FeedCubit extends Cubit<FeedState> {
  FeedCubit(this._repository) : super(const FeedInitial());

  final FeedRepository _repository;
  static const _pageSize = 20;
  List<DiscoveryFeedItem> _items = [];
  double? _lat;
  double? _lng;
  String? _nextCursor;

  Future<void> loadInitial({double? lat, double? lng}) async {
    _lat = lat;
    _lng = lng;
    emit(const FeedLoading([]));
    try {
      final page = await _repository.discover(
        lat: lat,
        lng: lng,
        limit: _pageSize,
      );
      _items = page.items;
      _nextCursor = page.nextCursor;
      emit(FeedLoaded(_items, hasMore: _nextCursor != null));
    } catch (e) {
      emit(FeedError(e.toString()));
    }
  }

  Future<void> loadMore() async {
    if (state is! FeedLoaded || !(state as FeedLoaded).hasMore) return;
    emit(FeedLoading(_items));
    try {
      final page = await _repository.discover(
        lat: _lat,
        lng: _lng,
        limit: _pageSize,
        cursor: _nextCursor,
      );
      _items = [..._items, ...page.items];
      _nextCursor = page.nextCursor;
      emit(FeedLoaded(_items, hasMore: _nextCursor != null));
    } catch (e) {
      emit(FeedError(e.toString()));
    }
  }

  Future<void> askAi(String rawInput) async {
    emit(FeedAiThinking(_items));
    try {
      final result = await _repository.translateIntent(
        rawInput,
        lat: _lat,
        lng: _lng,
      );
      emit(FeedAiResult(result, _items));
    } catch (e) {
      emit(FeedError(e.toString()));
    }
  }
}
