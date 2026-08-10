enum TimelineStatus { verifying, approved, disputed, scheduled, failed }

/// One row in the wallet's timeline — either a BNPL installment (client
/// owes money) or a project milestone (provider awaiting/receiving release).
/// Unified so the UI can render both through a single list + status dot.
class TimelineItem {
  const TimelineItem({
    required this.id,
    required this.label,
    required this.amount,
    required this.currency,
    required this.status,
    required this.date,
    required this.isInstallment,
  });

  final String id;
  final String label;
  final double amount;
  final String currency;
  final TimelineStatus status;
  final DateTime date;
  final bool isInstallment;

  factory TimelineItem.fromInstallmentJson(Map<String, dynamic> json) {
    final statusRaw = json['status'] as String;
    return TimelineItem(
      id: json['id'] as String,
      label:
          'Parcela ${json['installmentNumber']} — Projeto ${(json['escrowProject']?['id'] as String? ?? '').substring(0, 8)}',
      amount: double.tryParse('${json['amount']}') ?? 0,
      currency: json['currency'] as String? ?? 'USD',
      status: switch (statusRaw) {
        'CHARGED' => TimelineStatus.approved,
        'FAILED' => TimelineStatus.failed,
        _ => TimelineStatus.scheduled,
      },
      date:
          DateTime.tryParse(json['dueDate'] as String? ?? '') ?? DateTime.now(),
      isInstallment: true,
    );
  }

  factory TimelineItem.fromMilestoneJson(Map<String, dynamic> json) {
    final statusRaw = json['status'] as String;
    final project = json['project'] as Map<String, dynamic>?;
    return TimelineItem(
      id: json['id'] as String,
      label: json['title'] as String? ?? 'Meta do projeto',
      amount: double.tryParse('${json['releaseAmount'] ?? 0}') ?? 0,
      currency: project?['currency'] as String? ?? 'USD',
      status: switch (statusRaw) {
        'VERIFYING' => TimelineStatus.verifying,
        'APPROVED' => TimelineStatus.approved,
        _ => TimelineStatus.scheduled,
      },
      date:
          DateTime.tryParse(
            json['updatedAt'] as String? ?? json['createdAt'] as String? ?? '',
          ) ??
          DateTime.now(),
      isInstallment: false,
    );
  }
}

class WalletTimeline {
  const WalletTimeline(this.items);

  final List<TimelineItem> items;

  factory WalletTimeline.fromJson(Map<String, dynamic> json) {
    final installments = (json['installments'] as List? ?? [])
        .map((e) => TimelineItem.fromInstallmentJson(e as Map<String, dynamic>))
        .toList();
    final milestones = (json['milestones'] as List? ?? [])
        .map((e) => TimelineItem.fromMilestoneJson(e as Map<String, dynamic>))
        .toList();
    final combined = [...installments, ...milestones]
      ..sort((a, b) => a.date.compareTo(b.date));
    return WalletTimeline(combined);
  }
}
