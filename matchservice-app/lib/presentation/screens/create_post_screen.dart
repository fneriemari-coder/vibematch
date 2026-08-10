import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/moderation_alert.dart';
import '../../data/repositories/media_repository.dart';
import '../../data/repositories/post_repository.dart';

/// Discovery Feed post composer: optional photo/video attachment (uploaded
/// straight to S3 via MediaRepository before the post itself is created),
/// then POST /feed/post -> 422 -> showModerationBlockedModal path.
class CreatePostScreen extends StatefulWidget {
  const CreatePostScreen({super.key, required this.postRepository, required this.mediaRepository});

  final PostRepository postRepository;
  final MediaRepository mediaRepository;

  @override
  State<CreatePostScreen> createState() => _CreatePostScreenState();
}

class _CreatePostScreenState extends State<CreatePostScreen> {
  final _titleController = TextEditingController();
  final _contentController = TextEditingController();
  final _tagsController = TextEditingController();
  XFile? _pickedMedia;
  bool _submitting = false;
  bool _uploadingMedia = false;

  Future<void> _pickImage() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 90);
    if (file != null) setState(() => _pickedMedia = file);
  }

  Future<void> _pickVideo() async {
    final file = await ImagePicker().pickVideo(source: ImageSource.gallery);
    if (file != null) setState(() => _pickedMedia = file);
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      String? mediaUrl;
      final media = _pickedMedia;
      if (media != null) {
        setState(() => _uploadingMedia = true);
        mediaUrl = await widget.mediaRepository.uploadPickedFile(media, MediaPurpose.discoveryPost);
        setState(() => _uploadingMedia = false);
      }

      await widget.postRepository.createPost(
        title: _titleController.text.trim(),
        contentText: _contentController.text.trim(),
        mediaUrl: mediaUrl,
        tags: _tagsController.text.split(',').map((t) => t.trim().toUpperCase()).where((t) => t.isNotEmpty).toList(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Post publicado!')));
      Navigator.of(context).pop();
    } on PostBlockedException catch (e) {
      if (!mounted) return;
      await showModerationBlockedModal(context, reason: e.reason);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() { _submitting = false; _uploadingMedia = false; });
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _contentController.dispose();
    _tagsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final busy = _submitting || _uploadingMedia;
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Nova publicação')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _titleController,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: 'Título'),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _contentController,
              style: const TextStyle(color: Colors.white),
              maxLines: 5,
              decoration: const InputDecoration(labelText: 'Descrição'),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _tagsController,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: 'Tags (separadas por vírgula)'),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: busy ? null : _pickImage,
                  icon: const Icon(Icons.image_outlined),
                  label: const Text('Foto'),
                ),
                const SizedBox(width: 12),
                OutlinedButton.icon(
                  onPressed: busy ? null : _pickVideo,
                  icon: const Icon(Icons.videocam_outlined),
                  label: const Text('Vídeo'),
                ),
              ],
            ),
            if (_pickedMedia != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Selecionado: ${_pickedMedia!.name}',
                  style: VibeMatchTextStyles.body,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: busy ? null : _submit,
              child: busy
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Publicar'),
            ),
          ],
        ),
      ),
    );
  }
}
