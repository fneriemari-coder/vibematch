import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SimulationBehaviourService } from './simulation-behaviour.service';

/** Posts published per scheduled tick — enough to keep the feed moving, not enough to flood it. */
const POSTS_PER_TICK = 3;

/**
 * Runs the three behavioural bot actions on a schedule so the environment
 * stays alive between manual pokes.
 *
 * OFF BY DEFAULT, and the only thing that turns it on is
 * `SIMULATION_BOTS_ENABLED=true` — an exact string match, so a stray
 * `SIMULATION_BOTS_ENABLED=1` or an empty value leaves it off. A production
 * deployment that started inventing users, messages and posts on its own
 * would be far worse than having no bots at all, so there is deliberately no
 * default-on path and no way to enable it implicitly.
 *
 * The state is logged once at boot, because "are the bots running?" is the
 * first question anyone asks when unexplained data shows up.
 *
 * ScheduleModule.forRoot() is registered globally in AppModule — @Cron here
 * needs no further module wiring.
 */
@Injectable()
export class SimulationBotsScheduler implements OnModuleInit {
  private readonly logger = new Logger(SimulationBotsScheduler.name);
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly behaviour: SimulationBehaviourService,
  ) {
    this.enabled = this.config.get<string>('SIMULATION_BOTS_ENABLED') === 'true';
  }

  onModuleInit(): void {
    if (this.enabled) {
      this.logger.warn(
        'Bots de simulação HABILITADOS (SIMULATION_BOTS_ENABLED=true): contas @simulado.vibematch.dev vão ' +
          'responder swipes, responder no chat e publicar no feed automaticamente.',
      );
    } else {
      this.logger.log(
        'Bots de simulação desabilitados (padrão). Defina SIMULATION_BOTS_ENABLED=true para ligar o ' +
          'agendamento; as rotas manuais em /admin/simulation continuam disponíveis.',
      );
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    if (!this.enabled) return;

    try {
      const reciprocation = await this.behaviour.reciprocatePendingSwipes();
      const chats = await this.behaviour.replyToPendingChats();
      const posts = await this.behaviour.publishFeedPosts(POSTS_PER_TICK);

      this.logger.log(
        `Bot tick: ${reciprocation.matchesCreated} novos matches, ${chats.repliesSent} respostas de chat, ` +
          `${posts.created} publicações no feed.`,
      );
    } catch (error) {
      // A failing bot tick must never take the scheduler (or anything else)
      // down — this is decorative data, not a business process.
      this.logger.error(`Bot tick falhou: ${error instanceof Error ? error.message : error}`);
    }
  }
}
