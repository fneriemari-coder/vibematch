import 'package:flutter/material.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/admin_user_models.dart';
import '../../data/repositories/admin_repository.dart';
import '../widgets/vibe_glass_card.dart';

/// Admin user management — search, filter by status, ban/reactivate,
/// approve identity verification. Restricted to Role.ADMIN server-side
/// (RolesGuard on /admin/users/*); a 403 here means the account isn't an
/// admin, not a client bug.
class AdminUsersScreen extends StatefulWidget {
  const AdminUsersScreen({super.key, required this.adminRepository});

  final AdminRepository adminRepository;

  @override
  State<AdminUsersScreen> createState() => _AdminUsersScreenState();
}

class _AdminUsersScreenState extends State<AdminUsersScreen> {
  final _searchController = TextEditingController();
  AccountStatus? _statusFilter;
  Future<AdminUserListResult>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() {
      _future = widget.adminRepository.listUsers(
        search: _searchController.text.trim(),
        accountStatus: _statusFilter,
      );
    });
  }

  Future<void> _openDetail(AdminUserSummary user) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: VibeMatchColors.surface,
      isScrollControlled: true,
      builder: (sheetContext) => _UserActionsSheet(
        user: user,
        adminRepository: widget.adminRepository,
        onChanged: _load,
      ),
    );
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Usuários'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                TextField(
                  controller: _searchController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Buscar por nome ou e-mail',
                    suffixIcon: Icon(Icons.search),
                  ),
                  onSubmitted: (_) => _load(),
                ),
                const SizedBox(height: 12),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _StatusChip(
                        label: 'Todos',
                        selected: _statusFilter == null,
                        onTap: () {
                          _statusFilter = null;
                          _load();
                        },
                      ),
                      for (final status in AccountStatus.values)
                        Padding(
                          padding: const EdgeInsets.only(left: 8),
                          child: _StatusChip(
                            label: status.label,
                            selected: _statusFilter == status,
                            onTap: () {
                              _statusFilter = status;
                              _load();
                            },
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: FutureBuilder<AdminUserListResult>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Center(
                    child: CircularProgressIndicator(
                      color: VibeMatchColors.neonPrimary,
                    ),
                  );
                }
                if (snapshot.hasError) {
                  final isForbidden = snapshot.error.toString().contains('403');
                  return Center(
                    child: Text(
                      isForbidden
                          ? 'Acesso restrito a administradores.'
                          : 'Erro: ${snapshot.error}',
                      style: const TextStyle(color: VibeMatchColors.textLow),
                    ),
                  );
                }
                final result = snapshot.data!;
                if (result.users.isEmpty) {
                  return const Center(
                    child: Text(
                      'Nenhum usuário encontrado.',
                      style: TextStyle(color: VibeMatchColors.textLow),
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: result.users.length,
                    itemBuilder: (context, index) {
                      final user = result.users[index];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: InkWell(
                          onTap: () => _openDetail(user),
                          child: VibeGlassCard(
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        user.name,
                                        style: VibeMatchTextStyles.subheading,
                                      ),
                                      Text(
                                        user.email,
                                        style: VibeMatchTextStyles.body,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 4),
                                      Row(
                                        children: [
                                          _StatusBadge(
                                            status: user.accountStatus,
                                          ),
                                          if (user.identityVerified) ...[
                                            const SizedBox(width: 6),
                                            const Icon(
                                              Icons.verified,
                                              size: 14,
                                              color:
                                                  VibeMatchColors.neonPrimary,
                                            ),
                                          ],
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                                const Icon(
                                  Icons.chevron_right,
                                  color: VibeMatchColors.textLow,
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onTap(),
      selectedColor: VibeMatchColors.neonPrimary,
      backgroundColor: VibeMatchColors.surface,
      labelStyle: TextStyle(
        color: selected ? Colors.black : VibeMatchColors.textHigh,
        fontSize: 12,
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final AccountStatus status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      AccountStatus.active => const Color(0xFF10B981),
      AccountStatus.underReview => VibeMatchColors.scoreGold,
      AccountStatus.suspended => const Color(0xFFEF4444),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

class _UserActionsSheet extends StatefulWidget {
  const _UserActionsSheet({
    required this.user,
    required this.adminRepository,
    required this.onChanged,
  });

  final AdminUserSummary user;
  final AdminRepository adminRepository;
  final VoidCallback onChanged;

  @override
  State<_UserActionsSheet> createState() => _UserActionsSheetState();
}

class _UserActionsSheetState extends State<_UserActionsSheet> {
  bool _busy = false;

  Future<void> _setStatus(AccountStatus status) async {
    setState(() => _busy = true);
    try {
      await widget.adminRepository.updateAccountStatus(widget.user.id, status);
      widget.onChanged();
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Erro: $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _approveIdentity() async {
    setState(() => _busy = true);
    try {
      await widget.adminRepository.setIdentityVerified(widget.user.id, true);
      widget.onChanged();
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Erro: $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.user;
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            user.name,
            style: VibeMatchTextStyles.heading.copyWith(fontSize: 18),
          ),
          Text(user.email, style: VibeMatchTextStyles.body),
          const SizedBox(height: 20),
          if (_busy)
            const Center(
              child: CircularProgressIndicator(
                color: VibeMatchColors.neonPrimary,
              ),
            )
          else ...[
            if (user.accountStatus != AccountStatus.suspended)
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () => _setStatus(AccountStatus.suspended),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.redAccent,
                  ),
                  child: const Text('Banir usuário'),
                ),
              ),
            if (user.accountStatus == AccountStatus.suspended)
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => _setStatus(AccountStatus.active),
                  child: const Text('Reativar conta'),
                ),
              ),
            const SizedBox(height: 8),
            if (!user.identityVerified)
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _approveIdentity,
                  child: const Text('Aprovar verificação de identidade'),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
