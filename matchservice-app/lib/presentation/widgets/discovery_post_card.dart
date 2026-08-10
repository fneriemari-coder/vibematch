import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/feed_models.dart';
import 'vibe_glass_card.dart';

/// One full-bleed Discovery Feed slide: cached image or looping video
/// background, post metadata, and the fixed "Implementar no meu Negócio" CTA.
class DiscoveryPostCard extends StatefulWidget {
  const DiscoveryPostCard({
    super.key,
    required this.item,
    required this.isActive,
    required this.onImplement,
  });

  final DiscoveryFeedItem item;
  final bool
      isActive; // true only for the currently on-screen page — gates video playback
  final VoidCallback onImplement;

  @override
  State<DiscoveryPostCard> createState() => _DiscoveryPostCardState();
}

class _DiscoveryPostCardState extends State<DiscoveryPostCard> {
  VideoPlayerController? _controller;

  @override
  void initState() {
    super.initState();
    if (widget.item.isVideo) {
      _controller =
          VideoPlayerController.networkUrl(Uri.parse(widget.item.mediaUrl!))
            ..setLooping(true)
            ..initialize().then((_) {
              if (mounted) setState(() {});
              if (widget.isActive) _controller!.play();
            });
    }
  }

  @override
  void didUpdateWidget(covariant DiscoveryPostCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_controller == null || !_controller!.value.isInitialized) return;
    if (widget.isActive && !_controller!.value.isPlaying) {
      _controller!.play();
    } else if (!widget.isActive && _controller!.value.isPlaying) {
      _controller!.pause();
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        _buildMedia(),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Colors.transparent, Colors.black87],
              stops: [0.4, 1.0],
            ),
          ),
        ),
        Positioned(
          left: 16,
          right: 16,
          bottom: 110,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.item.creatorName,
                style: VibeMatchTextStyles.subheading,
              ),
              const SizedBox(height: 6),
              Text(
                widget.item.title,
                style: VibeMatchTextStyles.heading.copyWith(fontSize: 18),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  const Icon(Icons.favorite, size: 14, color: Colors.white70),
                  const SizedBox(width: 4),
                  Text(
                    '${widget.item.likesCount}',
                    style: VibeMatchTextStyles.body,
                  ),
                  const SizedBox(width: 16),
                  const Icon(
                    Icons.remove_red_eye,
                    size: 14,
                    color: Colors.white70,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${widget.item.viewsCount}',
                    style: VibeMatchTextStyles.body,
                  ),
                ],
              ),
            ],
          ),
        ),
        Positioned(
          left: 16,
          right: 16,
          bottom: 24,
          child: VibeGlassCard(
            padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 4),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: VibeMatchRadii.buttonRadius,
                onTap: widget.onImplement,
                child: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 14),
                  child: Center(
                    child: Text(
                      'Implementar no meu Negócio',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMedia() {
    if (_controller != null && _controller!.value.isInitialized) {
      return FittedBox(
        fit: BoxFit.cover,
        child: SizedBox(
          width: _controller!.value.size.width,
          height: _controller!.value.size.height,
          child: VideoPlayer(_controller!),
        ),
      );
    }
    if (widget.item.mediaUrl != null) {
      return CachedNetworkImage(
        imageUrl: widget.item.mediaUrl!,
        fit: BoxFit.cover,
        placeholder: (_, __) =>
            const ColoredBox(color: VibeMatchColors.surface),
        errorWidget: (_, __, ___) =>
            const ColoredBox(color: VibeMatchColors.surface),
      );
    }
    return const ColoredBox(color: VibeMatchColors.surface);
  }
}
