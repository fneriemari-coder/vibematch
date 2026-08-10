import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/repositories/auth_repository.dart';
import '../../logic/auth/auth_cubit.dart';

/// LGPD/GDPR self-service screen: download everything the account holds
/// (GET /users/me/data-export) and request erasure (DELETE /users/me).
class DataPrivacyScreen extends StatefulWidget {
  const DataPrivacyScreen({super.key, required this.authRepository});

  final AuthRepository authRepository;

  @override
  State<DataPrivacyScreen> createState() => _DataPrivacyScreenState();
}

class _DataPrivacyScreenState extends State<DataPrivacyScreen> {
  String? _exportedJson;
  bool _exporting = false;
  bool _deleting = false;

  Future<void> _exportData() async {
    setState(() => _exporting = true);
    try {
      final data = await widget.authRepository.exportMyData();
      final pretty = const JsonEncoder.withIndent('  ').convert(data);
      setState(() => _exportedJson = pretty);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Falha ao exportar dados: $e')));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _confirmDelete() async {
    final passwordController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: VibeMatchColors.surface,
        title: const Text(
          'Excluir minha conta',
          style: TextStyle(color: Colors.white),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Seus dados pessoais (nome, e-mail, localização) serão anonimizados. '
              'Registros financeiros e contratuais são mantidos por obrigação legal '
              'de guarda contábil/fiscal, sem identificar você. Essa ação não pode ser desfeita.',
              style: TextStyle(color: VibeMatchColors.textLow, fontSize: 13),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: passwordController,
              obscureText: true,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Confirme sua senha',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text(
              'Excluir',
              style: TextStyle(color: Colors.redAccent),
            ),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _deleting = true);
    try {
      await widget.authRepository.deleteMyAccount(passwordController.text);
      if (!mounted) return;
      await context.read<AuthCubit>().logout();
    } on DioException catch (e) {
      if (!mounted) return;
      final message = e.response?.data?['message']?.toString() ??
          'Não foi possível excluir a conta.';
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Privacidade e Dados')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Meus dados', style: VibeMatchTextStyles.subheading),
          const SizedBox(height: 8),
          Text(
            'Baixe uma cópia de tudo que temos associado à sua conta.',
            style: VibeMatchTextStyles.body,
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: _exporting ? null : _exportData,
            child: _exporting
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Baixar meus dados'),
          ),
          if (_exportedJson != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: VibeMatchColors.surface,
                borderRadius: VibeMatchRadii.cardRadius,
              ),
              child: SelectableText(
                _exportedJson!,
                style: const TextStyle(
                  color: Colors.white70,
                  fontFamily: 'monospace',
                  fontSize: 11,
                ),
              ),
            ),
          ],
          const SizedBox(height: 32),
          Text('Excluir conta', style: VibeMatchTextStyles.subheading),
          const SizedBox(height: 8),
          Text(
            'Solicite a exclusão/anonimização permanente dos seus dados pessoais.',
            style: VibeMatchTextStyles.body,
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: _deleting ? null : _confirmDelete,
            style: OutlinedButton.styleFrom(foregroundColor: Colors.redAccent),
            child: _deleting
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Excluir minha conta'),
          ),
        ],
      ),
    );
  }
}
