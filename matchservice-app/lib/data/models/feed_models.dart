enum SwipeMode { cloud, local, b2b }

extension SwipeModeApi on SwipeMode {
  String get apiValue => switch (this) {
        SwipeMode.cloud => 'CLOUD',
        SwipeMode.local => 'LOCAL',
        SwipeMode.b2b => 'B2B',
      };
}

class DiscoveryFeedItem {
  const DiscoveryFeedItem({
    required this.postId,
    required this.title,
    required this.contentText,
    required this.mediaUrl,
    required this.videoDurationSeconds,
    required this.likesCount,
    required this.viewsCount,
    required this.creatorId,
    required this.creatorName,
    required this.skillTagId,
    required this.source,
  });

  final String postId;
  final String title;
  final String contentText;
  final String? mediaUrl;
  final int? videoDurationSeconds;
  final int likesCount;
  final int viewsCount;
  final String creatorId;
  final String creatorName;
  final String? skillTagId;
  final String source; // 'CLOUD' | 'LOCAL'

  bool get isVideo => mediaUrl != null && videoDurationSeconds != null;

  factory DiscoveryFeedItem.fromJson(Map<String, dynamic> json) => DiscoveryFeedItem(
        postId: json['postId'] as String,
        title: json['title'] as String,
        contentText: json['contentText'] as String? ?? '',
        mediaUrl: json['mediaUrl'] as String?,
        videoDurationSeconds: json['videoDurationSeconds'] as int?,
        likesCount: json['likesCount'] as int? ?? 0,
        viewsCount: json['viewsCount'] as int? ?? 0,
        creatorId: (json['creator'] as Map<String, dynamic>?)?['id'] as String? ?? '',
        creatorName: (json['creator'] as Map<String, dynamic>?)?['name'] as String? ?? '',
        skillTagId: json['skillTagId'] as String?,
        source: json['source'] as String? ?? 'CLOUD',
      );
}

class AiTranslateResult {
  const AiTranslateResult({
    required this.interpretedNeeds,
    required this.suggestedMode,
  });

  final List<String> interpretedNeeds;
  final String suggestedMode; // 'CLOUD' | 'LOCAL'

  factory AiTranslateResult.fromJson(Map<String, dynamic> json) => AiTranslateResult(
        interpretedNeeds: (json['interpretedNeeds'] as List).cast<String>(),
        suggestedMode: json['suggestedMode'] as String,
      );
}
