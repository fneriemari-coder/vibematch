import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Currency,
  EscrowStatus,
  MilestoneStatus,
  Prisma,
  Role,
  SwipeDirection,
  SwipeMode,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SwipesService } from '../swipes/swipes.service';
import { EscrowService } from '../escrow/escrow.service';
import { SimulationBehaviourService } from './simulation-behaviour.service';
import { SIMULATED_EMAIL_DOMAIN, parseSimulatedIndex, specialtyKeyFor } from './simulation.core';

/** Deal sizes that read like a real small engagement rather than a round test number. */
const DEMO_BUDGET_BRL = 6800;
const DEMO_BUDGET_USD = 1250;

const MINUTE_MS = 60 * 1000;

/**
 * Drives one simulated professional through the entire funnel against a real
 * user, in a single call, so the owner can open the app and find a finished,
 * inspectable deal instead of having to manufacture one by hand.
 *
 * Honest scope note, repeated in the response payload: what this produces is
 * a simulated *contract lifecycle* (match → chat → escrow → funded →
 * milestones released to the wallet ledger → completed), not a real payment.
 * No card is charged, no Stripe Checkout is completed and no Stripe transfer
 * happens anywhere in here; the wallet entries are ledger rows of exactly the
 * kind the milestone release path writes.
 *
 * The match, the chat and the escrow creation all go through the real
 * services (`SwipesService`, `EscrowService.create`) so their rules — double
 * opt-in, "B2B matches never open escrow" — keep applying. Only the funding
 * transition is simulated, and `simulateFunding()` below explains why.
 */
@Injectable()
export class SimulationJourneyService {
  private readonly logger = new Logger(SimulationJourneyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly swipesService: SwipesService,
    private readonly escrowService: EscrowService,
    private readonly behaviour: SimulationBehaviourService,
  ) {}

  async runDemoJourney(targetUserId: string) {
    const client = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, country: true, role: true, walletBalance: true },
    });
    if (!client) throw new NotFoundException('Usuário alvo não encontrado');
    if (parseSimulatedIndex(client.email) !== null) {
      throw new BadRequestException(
        'O alvo da jornada precisa ser um usuário real — rodar bot contra bot não demonstra nada.',
      );
    }

    const provider = await this.pickProvider(targetUserId);
    const providerIndex = parseSimulatedIndex(provider.email) ?? 0;
    const specialty = specialtyKeyFor(providerIndex);

    // 1) Mutual match, through the real swipe path on both sides so the
    //    double opt-in check is the thing that creates the Match.
    const match = await this.createMutualMatch(targetUserId, provider.id);

    // 2) A believable exchange: brief, questions, scope, price, agreement.
    const messages = await this.seedConversation(match.id, client, provider, specialty);

    // 3) Escrow via EscrowService.create — never a direct row write, so the
    //    "B2B matches never open escrow" rule keeps applying.
    const currency = client.country === 'BR' ? Currency.BRL : Currency.USD;
    const budget = currency === Currency.BRL ? DEMO_BUDGET_BRL : DEMO_BUDGET_USD;

    const escrow = await this.escrowService.create(targetUserId, {
      matchId: match.id,
      clientId: targetUserId,
      providerId: provider.id,
      budget,
      currency,
    });

    // 4) funded -> milestones released -> complete.
    await this.simulateFunding(escrow.id);
    const milestones = await this.createMilestones(escrow.id, specialty, budget);
    await this.releaseMilestones(escrow.id);
    const completed = await this.escrowService.complete(escrow.id, targetUserId);

    const [clientAfter, providerAfter, score, walletEntries] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: targetUserId }, select: { walletBalance: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: provider.id }, select: { walletBalance: true } }),
      this.prisma.providerScore.findUnique({ where: { providerId: provider.id } }),
      this.prisma.walletTransaction.findMany({
        where: { relatedEscrowId: escrow.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, type: true, amount: true, currency: true, userId: true },
      }),
    ]);

    this.logger.log(
      `Demo journey: simulated contract lifecycle completed for client ${targetUserId} with provider ` +
        `${provider.id} (match ${match.id}, escrow ${escrow.id}). No real payment was processed.`,
    );

    return {
      disclaimer:
        'Ciclo de contrato SIMULADO. Nenhum cartão foi cobrado: o Stripe Checkout real (POST /escrow/:id/fund) ' +
        'foi contornado e o projeto foi marcado como FUNDED diretamente. Os lançamentos de carteira abaixo são ' +
        'registros de ledger, não pagamentos processados.',
      client: { userId: client.id, email: client.email, walletBalance: clientAfter.walletBalance },
      provider: {
        userId: provider.id,
        email: provider.email,
        name: provider.name,
        specialty,
        walletBalance: providerAfter.walletBalance,
        financialHealthScore: score?.financialHealthScore ?? null,
        previousFinancialHealthScore: score?.previousFinancialHealthScore ?? null,
      },
      matchId: match.id,
      matchType: match.type,
      messageCount: messages.length,
      messages: messages.map((m) => ({ senderId: m.senderId, content: m.content, createdAt: m.createdAt })),
      escrowId: escrow.id,
      budget,
      currency,
      finalStatus: completed.status,
      fundedAt: completed.fundedAt,
      completedAt: completed.completedAt,
      milestones: milestones.map((m) => ({ id: m.id, title: m.title, status: MilestoneStatus.APPROVED })),
      walletEntries,
    };
  }

  // -------------------------------------------------------------------

  /**
   * A simulated PROVIDER/BOTH not already matched with the target user,
   * preferring an archetype that has a bespoke conversation and bespoke
   * milestones written for it.
   *
   * The generic fallback script is coherent but says nothing specific about
   * the trade, and the whole point of this endpoint is that the owner opens
   * the chat and reads something that sounds like a real professional.
   */
  private async pickProvider(targetUserId: string) {
    const candidates = await this.prisma.user.findMany({
      where: {
        email: { endsWith: `@${SIMULATED_EMAIL_DOMAIN}` },
        role: { in: [Role.PROVIDER, Role.BOTH] },
        deletedAt: null,
        id: { not: targetUserId },
        // Skip anyone this user already has a deal-capable match with, so a
        // second run produces a second, independent story.
        AND: [
          { matchesAsOne: { none: { userTwoId: targetUserId } } },
          { matchesAsTwo: { none: { userOneId: targetUserId } } },
        ],
      },
      select: { id: true, email: true, profile: { select: { name: true } } },
      orderBy: { email: 'asc' },
    });

    const scripted = candidates.find((candidate) => {
      const index = parseSimulatedIndex(candidate.email);
      return index !== null && CONVERSATION_SCRIPTS[specialtyKeyFor(index)] !== undefined;
    });

    const provider = scripted ?? candidates[0];
    if (!provider) {
      throw new BadRequestException(
        'Nenhum prestador simulado disponível para a jornada. Rode POST /admin/simulation/users primeiro ' +
          '(ou apague os matches existentes deste usuário).',
      );
    }
    return { id: provider.id, email: provider.email, name: provider.profile?.name ?? 'Profissional' };
  }

  /**
   * Both swipes go through `SwipesService.swipe`; the Match is created by its
   * double opt-in branch, exactly as it would be for two real people.
   */
  private async createMutualMatch(clientId: string, providerId: string) {
    await this.swipesService.swipe(clientId, {
      swipedId: providerId,
      direction: SwipeDirection.LIKE,
      mode: SwipeMode.CLOUD,
    });
    const result = await this.swipesService.swipe(providerId, {
      swipedId: clientId,
      direction: SwipeDirection.LIKE,
      mode: SwipeMode.CLOUD,
    });

    if (!result.match) {
      throw new BadRequestException(
        'Não foi possível criar o match — provavelmente já existe um swipe anterior entre esses usuários no modo CLOUD.',
      );
    }
    return result.match;
  }

  /**
   * A short, plausible exchange written in the specialty's voice: the
   * client's brief, the provider's qualifying questions, an agreed scope and
   * an agreed price. Timestamps are backdated a few minutes apart so the
   * thread reads like a conversation, not a bulk insert.
   */
  private async seedConversation(
    matchId: string,
    client: { id: string; country: string },
    provider: { id: string; email: string },
    specialty: string,
  ) {
    const script = CONVERSATION_SCRIPTS[specialty] ?? DEFAULT_CONVERSATION;
    const providerCountry = 'BR';
    const start = Date.now() - 40 * MINUTE_MS;

    const created = [];
    for (let i = 0; i < script.length; i++) {
      const line = script[i];
      const fromClient = line.from === 'client';
      const message = await this.behaviour.persistMessage(
        matchId,
        fromClient ? client.id : provider.id,
        fromClient ? client.country : providerCountry,
        fromClient ? providerCountry : client.country,
        line.text,
        new Date(start + i * 4 * MINUTE_MS),
      );
      created.push(message);
    }
    return created;
  }

  /**
   * Moves the project PENDING → FUNDED without money.
   *
   * `EscrowService.fund()` is deliberately NOT used here: it opens a real
   * Stripe Checkout session and returns a URL, leaving the project PENDING
   * until Stripe's webhook confirms an actual card payment. That is correct
   * for production and impossible for an unattended demo — there is no card
   * to charge and no public webhook endpoint. So this writes the same
   * transition the webhook would, and the response says plainly that no
   * payment was processed.
   *
   * This is the one place in the journey that bypasses a real service, and it
   * is bypassed because the real path requires a human with a credit card.
   */
  private async simulateFunding(escrowId: string) {
    return this.prisma.escrowProject.update({
      where: { id: escrowId },
      data: { status: EscrowStatus.FUNDED, fundedAt: new Date() },
    });
  }

  /** Two milestones, phrased for the provider's trade, splitting the budget 40/60. */
  private async createMilestones(escrowId: string, specialty: string, budget: number) {
    const titles = MILESTONE_TITLES[specialty] ?? DEFAULT_MILESTONES;
    const splits = [0.4, 0.6];

    const milestones = [];
    for (let i = 0; i < titles.length; i++) {
      milestones.push(
        await this.prisma.projectMilestone.create({
          data: {
            projectId: escrowId,
            title: titles[i].title,
            criteriaDescription: titles[i].criteria,
            releaseAmount: new Prisma.Decimal(budget * splits[i]),
          },
        }),
      );
    }
    return milestones;
  }

  /**
   * Approves the milestones and credits the provider's wallet, mirroring
   * `AiValidatorService.releaseMilestoneFunds` — same transaction type
   * (MILESTONE_RELEASE), same atomic ledger-row-plus-balance write.
   *
   * The AI audit itself is deliberately skipped: it requires a working
   * OPENAI_API_KEY and, without one, fails the milestone back to PENDING —
   * which would leave the demo stuck halfway with no way to finish. The
   * project is left FUNDED so the final transition is the client's own
   * `EscrowService.complete()`.
   */
  private async releaseMilestones(escrowId: string) {
    await this.prisma.$transaction(async (tx) => {
      const project = await tx.escrowProject.findUniqueOrThrow({ where: { id: escrowId } });
      const milestones = await tx.projectMilestone.findMany({ where: { projectId: escrowId } });

      for (const milestone of milestones) {
        const amount =
          milestone.releaseAmount !== null
            ? new Prisma.Decimal(milestone.releaseAmount)
            : new Prisma.Decimal(Number(project.budget) / Math.max(milestones.length, 1));

        await tx.projectMilestone.update({
          where: { id: milestone.id },
          data: {
            status: MilestoneStatus.APPROVED,
            releaseAmount: amount,
            aiFeedbackLog: `[${new Date().toISOString()}] Entrega aprovada no fluxo de simulação (sem auditoria de IA).`,
          },
        });

        await tx.walletTransaction.create({
          data: {
            userId: project.providerId,
            type: WalletTransactionType.MILESTONE_RELEASE,
            amount,
            currency: project.currency,
            relatedEscrowId: project.id,
            metadata: { milestoneId: milestone.id, simulated: true },
          },
        });

        await tx.user.update({
          where: { id: project.providerId },
          data: { walletBalance: { increment: amount } },
        });
      }

      if (project.status !== EscrowStatus.FUNDED) {
        throw new BadRequestException(`Projeto precisa estar FUNDED para liberar marcos (está ${project.status})`);
      }
    });
  }
}

interface ScriptLine {
  from: 'client' | 'provider';
  text: string;
}

const DEFAULT_CONVERSATION: ScriptLine[] = [
  { from: 'client', text: 'Oi! Vi seu perfil e queria entender se você atende o que eu preciso.' },
  { from: 'provider', text: 'Oi, tudo bem? Atendo sim. Me conta um pouco do contexto e do prazo que você tem.' },
  { from: 'client', text: 'É um projeto de porte médio, preciso entregue em umas quatro semanas.' },
  {
    from: 'provider',
    text: 'Dá para fazer nesse prazo. Proponho dividir em duas etapas, com entrega parcial na segunda semana para você validar antes de seguir.',
  },
  { from: 'client', text: 'Fechado. Qual o valor?' },
  { from: 'provider', text: 'Fecho o escopo completo, com as duas etapas e ajustes incluídos. Abro o projeto aqui na plataforma para você.' },
  { from: 'client', text: 'Perfeito, pode abrir. Combinado.' },
];

/**
 * Conversation per specialty. Only the archetypes most likely to be picked
 * first are scripted individually; the rest fall back to DEFAULT_CONVERSATION,
 * which is generic in scope but not in voice.
 */
const CONVERSATION_SCRIPTS: Record<string, ScriptLine[]> = {
  'Automação com IA': [
    {
      from: 'client',
      text: 'Oi! A gente perde muito tempo passando pedido do formulário do site para a planilha e depois para o financeiro. Dá para automatizar isso?',
    },
    {
      from: 'provider',
      text: 'Oi, tudo bem? Dá sim, e é um dos casos mais diretos que existem. Duas perguntas: quantos pedidos por semana passam por aí, e quem faz essa digitação hoje?',
    },
    { from: 'client', text: 'Uns 120 por semana, e é uma pessoa do administrativo que gasta quase duas horas por dia nisso.' },
    {
      from: 'provider',
      text: 'Duas horas por dia é dez horas por semana de uma pessoa — isso paga o projeto em poucos meses. Faço assim: mapeio o fluxo atual, monto a integração entre o formulário, a planilha e o financeiro, e deixo um alerta para quando algum pedido falhar. Uma semana de mapeamento, duas de construção e ajuste.',
    },
    { from: 'client', text: 'E se mudar o formato do formulário depois?' },
    {
      from: 'provider',
      text: 'Entrego documentado, com o passo a passo em texto simples, e treino uma segunda pessoa de vocês. É justamente o que evita a automação morrer quando alguém sai de férias.',
    },
    { from: 'client', text: 'Ótimo, é isso mesmo que a gente precisa. Pode abrir o projeto.' },
    {
      from: 'provider',
      text: 'Fechado. Abrindo aqui com duas etapas: mapeamento e fluxo em produção. Você valida a primeira antes de eu seguir.',
    },
  ],
  'Integrações de pagamento': [
    { from: 'client', text: 'Oi! Nosso financeiro reclama toda semana que a baixa do gateway não bate com o extrato. Você resolve esse tipo de coisa?' },
    {
      from: 'provider',
      text: 'Oi! Resolvo, é literalmente o meu dia a dia. Antes de propor qualquer coisa: vocês conseguem listar hoje quais eventos de webhook falharam nos últimos trinta dias?',
    },
    { from: 'client', text: 'Sinceramente não. A gente só descobre quando o cliente reclama que pagou e não liberou.' },
    {
      from: 'provider',
      text: 'Então é quase certo que tem receita vazando em silêncio. Começo por uma auditoria dos eventos dos últimos noventa dias e a partir dela arrumo validação de assinatura, retentativa idempotente e um relatório semanal de conciliação.',
    },
    { from: 'client', text: 'Quanto tempo leva?' },
    {
      from: 'provider',
      text: 'Duas etapas: auditoria com o diagnóstico por escrito na primeira semana, correção e conciliação nas duas seguintes. Você aprova o diagnóstico antes de eu tocar em código de produção.',
    },
    { from: 'client', text: 'Combinado, pode abrir o projeto.' },
  ],
  'Edição de vídeo curto': [
    { from: 'client', text: 'Oi! Tenho umas oito lives gravadas paradas e queria transformar em cortes. Você trabalha com isso?' },
    { from: 'provider', text: 'Oi! Trabalho, é o meu formato principal. Quantos cortes por mês você imagina, e você já tem uma ideia dos trechos que funcionam?' },
    { from: 'client', text: 'Uns doze por mês. Ideia dos trechos eu não tenho, esperava que você escolhesse.' },
    {
      from: 'provider',
      text: 'Eu escolho sim, é parte do trabalho. Assisto o bruto, separo os trechos que se sustentam sozinhos e entrego com legenda e capa. Mando sempre duas versões do gancho inicial dos três primeiros, porque testar a abertura muda o alcance do vídeo inteiro.',
    },
    { from: 'client', text: 'Isso é ótimo. Prazo?' },
    { from: 'provider', text: 'Primeiro lote de seis em uma semana, o restante na semana seguinte, para você já publicar enquanto eu termino.' },
    { from: 'client', text: 'Fechado, pode abrir.' },
  ],
  'Controladoria e BPO financeiro': [
    { from: 'client', text: 'Oi! A empresa cresceu e o controle continua em planilha. Fecho o mês só lá pelo dia 20 e sem confiança nenhuma no número.' },
    { from: 'provider', text: 'Oi! Situação bem comum. Duas perguntas: existe projeção de caixa hoje, ou o controle é o saldo do banco? E vocês têm centro de custo separado?' },
    { from: 'client', text: 'É o saldo do banco mesmo. Centro de custo não existe.' },
    {
      from: 'provider',
      text: 'Então a primeira coisa é separar caixa de resultado. Monto plano de contas com centro de custo, rotina de conciliação e a projeção rolante de treze semanas, que é o que mostra aperto com antecedência de agir.',
    },
    { from: 'client', text: 'E depois disso a gente fica dependente de você?' },
    { from: 'provider', text: 'Não. Treino uma pessoa de vocês na rotina semanal e saio de cena. O objetivo é a estrutura ficar, não eu ficar.' },
    { from: 'client', text: 'É exatamente isso que eu queria ouvir. Pode abrir o projeto.' },
  ],
  'Encanamento residencial': [
    { from: 'client', text: 'Boa tarde! Estou com uma infiltração no teto do banheiro e a conta de água subiu bastante. Você consegue ver isso?' },
    { from: 'provider', text: 'Boa tarde! Consigo sim. É casa ou apartamento? E a mancha aumenta quando alguém usa o chuveiro de cima?' },
    { from: 'client', text: 'Apartamento, e sim, piora depois do banho do pessoal de cima.' },
    {
      from: 'provider',
      text: 'Isso aponta para o ramal do vizinho e não para a sua coluna. Faço o teste de pressão por trecho antes de quebrar qualquer coisa — já cheguei em obra com três paredes abertas por causa de um registro externo.',
    },
    { from: 'client', text: 'Ótimo, prefiro não quebrar nada à toa. Como funciona o orçamento?' },
    { from: 'provider', text: 'Visita de diagnóstico com valor fixo, que eu abato do serviço se você fechar comigo. Levo o material comum na van, então na maioria dos casos resolvo no mesmo dia.' },
    { from: 'client', text: 'Perfeito, pode abrir o projeto.' },
  ],
};

interface MilestoneSpec {
  title: string;
  criteria: string;
}

const DEFAULT_MILESTONES: MilestoneSpec[] = [
  {
    title: 'Etapa 1 — Diagnóstico e escopo aprovado',
    criteria: 'Documento de escopo entregue e aprovado pelo cliente, com prazo e critérios de aceite por escrito.',
  },
  {
    title: 'Etapa 2 — Entrega final e ajustes',
    criteria: 'Entrega completa conforme o escopo aprovado, com uma rodada de ajustes incluída.',
  },
];

const MILESTONE_TITLES: Record<string, MilestoneSpec[]> = {
  'Automação com IA': [
    {
      title: 'Etapa 1 — Mapeamento do fluxo atual',
      criteria: 'Fluxo atual documentado com tempo gasto por semana medido e pontos de falha identificados.',
    },
    {
      title: 'Etapa 2 — Automação em produção e documentada',
      criteria: 'Integração rodando em produção, com alerta de falha, manual operacional e uma segunda pessoa treinada.',
    },
  ],
  'Integrações de pagamento': [
    {
      title: 'Etapa 1 — Auditoria dos eventos de pagamento',
      criteria: 'Relatório dos eventos de webhook dos últimos 90 dias, com falhas listadas e impacto financeiro estimado.',
    },
    {
      title: 'Etapa 2 — Correção e conciliação semanal',
      criteria: 'Validação de assinatura, retentativa idempotente e relatório semanal de conciliação em produção.',
    },
  ],
  'Edição de vídeo curto': [
    {
      title: 'Etapa 1 — Primeiro lote de 6 cortes',
      criteria: 'Seis cortes entregues com legenda e capa, sendo três com duas versões de gancho.',
    },
    {
      title: 'Etapa 2 — Lote final e ajustes',
      criteria: 'Seis cortes restantes entregues, com os ajustes solicitados no primeiro lote aplicados.',
    },
  ],
  'Controladoria e BPO financeiro': [
    {
      title: 'Etapa 1 — Plano de contas e centro de custo',
      criteria: 'Plano de contas implantado, centros de custo definidos e três meses históricos reclassificados.',
    },
    {
      title: 'Etapa 2 — Projeção de 13 semanas e time treinado',
      criteria: 'Projeção rolante em uso, rotina semanal documentada e uma pessoa do cliente treinada para mantê-la.',
    },
  ],
  'Encanamento residencial': [
    {
      title: 'Etapa 1 — Diagnóstico com teste de pressão',
      criteria: 'Origem do vazamento localizada e comprovada por teste de pressão, sem quebra exploratória.',
    },
    {
      title: 'Etapa 2 — Reparo executado e testado',
      criteria: 'Reparo concluído, testado sob pressão por 24 horas e área entregue limpa.',
    },
  ],
};
