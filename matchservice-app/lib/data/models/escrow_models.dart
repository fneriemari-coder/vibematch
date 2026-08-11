import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';

/// Models for GET /escrow — the contracts side of the marketplace.
///
/// A match is only the introduction; the deal is what the platform actually
/// supervises. These are the rows that back that.

/// Lifecycle of a project's money. Mirrors the backend `EscrowStatus` enum;
/// anything unrecognised falls back to `pending` rather than throwing, so a
/// future server-side status never crashes an older client.
enum EscrowStatus { pending, funded, completed, disputed, refunded, canceled }

EscrowStatus escrowStatusFromWire(String value) => switch (value) {
      'FUNDED' => EscrowStatus.funded,
      'COMPLETED' => EscrowStatus.completed,
      'DISPUTED' => EscrowStatus.disputed,
      'REFUNDED' => EscrowStatus.refunded,
      'CANCELED' => EscrowStatus.canceled,
      _ => EscrowStatus.pending,
    };

extension EscrowStatusDisplay on EscrowStatus {
  String get label => switch (this) {
        EscrowStatus.pending => 'Aguardando depósito',
        EscrowStatus.funded => 'Valor em custódia',
        EscrowStatus.completed => 'Concluído',
        EscrowStatus.disputed => 'Em disputa',
        EscrowStatus.refunded => 'Reembolsado',
        EscrowStatus.canceled => 'Cancelado',
      };

  /// What this status means for the person reading it — the status word alone
  /// does not tell a client whether their money is at risk.
  String get explanation => switch (this) {
        EscrowStatus.pending =>
          'O contrato existe, mas o dinheiro ainda não foi depositado. O profissional não deve começar antes disso.',
        EscrowStatus.funded =>
          'O valor está retido pela plataforma. Ele só vai para o profissional quando as entregas forem aprovadas.',
        EscrowStatus.completed =>
          'As entregas foram aprovadas e o valor foi liberado para o profissional.',
        EscrowStatus.disputed =>
          'Há uma divergência aberta. O valor fica retido até a análise terminar.',
        EscrowStatus.refunded => 'O valor retornou para o cliente.',
        EscrowStatus.canceled =>
          'O contrato foi encerrado antes do depósito. Nenhum valor foi movimentado.',
      };

  Color get color => switch (this) {
        EscrowStatus.pending => VibeMatchColors.textLow,
        EscrowStatus.funded => VibeMatchColors.scoreGold,
        EscrowStatus.completed => VibeMatchColors.positive,
        EscrowStatus.disputed => VibeMatchColors.live,
        EscrowStatus.refunded => VibeMatchColors.textLow,
        EscrowStatus.canceled => VibeMatchColors.textLow,
      };
}

class EscrowProject {
  const EscrowProject({
    required this.id,
    required this.matchId,
    required this.status,
    required this.budget,
    required this.currency,
    required this.paymentModel,
    required this.installmentCount,
    required this.advanced,
    required this.isClient,
    required this.counterpartId,
    required this.counterpartName,
    required this.milestoneTotal,
    required this.milestoneApproved,
    required this.createdAt,
  });

  final String id;
  final String matchId;
  final EscrowStatus status;
  final double budget;
  final String currency;

  /// `UPFRONT` or `BNPL_FINANCED`.
  final String paymentModel;
  final int? installmentCount;

  /// The provider already cashed out early against this project.
  final bool advanced;

  /// Which side the signed-in user is on. The available actions differ
  /// completely — only the client funds, only the provider delivers.
  final bool isClient;
  final String counterpartId;
  final String counterpartName;
  final int milestoneTotal;
  final int milestoneApproved;
  final DateTime createdAt;

  bool get isFinanced => paymentModel == 'BNPL_FINANCED';

  /// 0..1 across approved milestones. A project with no milestones defined
  /// reports 0 rather than dividing by zero.
  double get progress =>
      milestoneTotal == 0 ? 0 : milestoneApproved / milestoneTotal;

  factory EscrowProject.fromJson(Map<String, dynamic> json) => EscrowProject(
        id: json['id'] as String,
        matchId: json['matchId'] as String? ?? '',
        status: escrowStatusFromWire(json['status'] as String? ?? 'PENDING'),
        // Prisma Decimal arrives as a string; a plain cast would throw.
        budget: double.tryParse('${json['budget'] ?? 0}') ?? 0,
        currency: json['currency'] as String? ?? 'BRL',
        paymentModel: json['paymentModel'] as String? ?? 'UPFRONT',
        installmentCount: json['installmentCount'] as int?,
        advanced: json['advanced'] as bool? ?? false,
        isClient: json['role'] == 'CLIENT',
        counterpartId: json['counterpartId'] as String? ?? '',
        counterpartName: json['counterpartName'] as String? ?? 'Usuário',
        milestoneTotal: json['milestoneTotal'] as int? ?? 0,
        milestoneApproved: json['milestoneApproved'] as int? ?? 0,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}
