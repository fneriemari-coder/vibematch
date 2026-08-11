import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { DiscoveryPost, PostTag, Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

interface TrendAlertCopy {
  title: string;
  body: string;
}

/**
 * Batch push delivery via Firebase Cloud Messaging. Segregates copy by
 * CLIENT vs PROVIDER and self-heals stale FCM tokens (a user who uninstalled
 * or reinstalled the app) so the users table never accumulates dead tokens
 * that would otherwise fail every future send.
 */
@Injectable()
export class PushNotificationService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationService.name);
  private enabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Reported by GET /health so the deployment can be checked without log access. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  onModuleInit() {
    // Two accepted forms. FIREBASE_SERVICE_ACCOUNT_B64 exists because the raw
    // JSON is multi-line and several hosting dashboards (Railway among them)
    // treat a pasted multi-line value as a dotenv block of many variables —
    // which silently replaces the rest of the environment, taking DATABASE_URL
    // with it. A single-line base64 blob cannot be misread that way.
    const base64 = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_B64');
    const raw = base64
      ? Buffer.from(base64, 'base64').toString('utf8')
      : this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');

    if (!raw) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON / _B64 not set — push notifications disabled',
      );
      return;
    }

    // A malformed credential must not take the whole API down: push is
    // optional, everything else on this deployment is not.
    try {
      if (admin.apps.length === 0) {
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
      }
      this.enabled = true;
      this.logger.log('Firebase Admin initialised — push notifications enabled');
    } catch (err) {
      this.logger.error(
        `Firebase service account could not be parsed — push notifications disabled: ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Notifies users whose country matches the post's target market (BR/US)
   * and whose profile skills overlap the viral post's tags. CLIENT and
   * PROVIDER audiences get different copy — one is a "hire this now" hook,
   * the other a "demand spike, go get it" hook.
   */
  async sendTrendAlert(post: DiscoveryPost, tags: PostTag[]): Promise<void> {
    if (!this.enabled) {
      this.logger.debug(`Push disabled — skipping trend alert for post ${post.id}`);
      return;
    }

    const tagNames = tags.map((t) => t.tagName);
    const modeTarget = tagNames.some((t) => t.startsWith('LOCAL')) ? 'LOCAL' : 'NUVEM';

    const recipients = await this.prisma.user.findMany({
      where: {
        fcmToken: { not: null },
        profile: { skills: { hasSome: tagNames } },
      },
      select: { id: true, role: true, fcmToken: true, country: true },
    });

    if (recipients.length === 0) return;

    const primaryTag = tagNames[0] ?? 'sua área';
    const messages: admin.messaging.Message[] = recipients.map((recipient) => {
      const copy = this.copyFor(recipient.role, primaryTag);
      return {
        token: recipient.fcmToken!,
        notification: { title: copy.title, body: copy.body },
        data: { post_id: post.id, mode_target: modeTarget },
      };
    });

    await this.sendBatch(messages, recipients.map((r) => r.id));
  }

  /**
   * Single urgent push to one user (e.g. a maintenance-monitoring alert) —
   * same stale-token self-heal as sendTrendAlert, just for a batch of one.
   */
  async sendUrgentAlert(userId: string, title: string, body: string, data: Record<string, string> = {}): Promise<void> {
    if (!this.enabled) {
      this.logger.debug(`Push disabled — skipping urgent alert for user ${userId}`);
      return;
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
    if (!user?.fcmToken) return;

    await this.sendBatch([{ token: user.fcmToken, notification: { title, body }, data }], [userId]);
  }

  /**
   * True multicast send (`sendEachForMulticast`) — one shared
   * notification/data payload fanned out to many tokens in a single Admin
   * SDK call, cheaper than N individual `sendEach` messages when everyone
   * gets identical copy (e.g. a retention push tied to one course). Same
   * stale-token self-heal as the other senders.
   */
  async sendMulticastAlert(
    userIds: string[],
    title: string,
    body: string,
    data: Record<string, string> = {},
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.debug(`Push disabled — skipping multicast alert to ${userIds.length} user(s)`);
      return;
    }
    if (userIds.length === 0) return;

    const recipients = await this.prisma.user.findMany({
      where: { id: { in: userIds }, fcmToken: { not: null } },
      select: { id: true, fcmToken: true },
    });
    if (recipients.length === 0) return;

    const MULTICAST_TOKEN_LIMIT = 500; // FCM hard cap per sendEachForMulticast call
    for (let i = 0; i < recipients.length; i += MULTICAST_TOKEN_LIMIT) {
      const batch = recipients.slice(i, i + MULTICAST_TOKEN_LIMIT);
      const tokens = batch.map((r) => r.fcmToken!);

      let response: admin.messaging.BatchResponse;
      try {
        response = await admin.messaging().sendEachForMulticast({ tokens, notification: { title, body }, data });
      } catch (err) {
        this.logger.error(`Multicast send failed for a batch of ${tokens.length}: ${(err as Error).message}`);
        continue; // one bad batch must not abort the rest
      }

      const staleUserIds: string[] = [];
      response.responses.forEach((r, idx) => {
        if (!r.success && this.isTokenInvalid(r.error?.code)) {
          staleUserIds.push(batch[idx].id);
        }
      });
      if (staleUserIds.length > 0) {
        await this.prisma.user.updateMany({ where: { id: { in: staleUserIds } }, data: { fcmToken: null } });
        this.logger.log(`Cleared ${staleUserIds.length} stale FCM token(s) from multicast batch`);
      }
    }
  }

  private copyFor(role: Role, tagName: string): TrendAlertCopy {
    if (role === Role.CLIENT) {
      return {
        title: `Nova estratégia de ${tagName} está viralizando! 🔥`,
        body: 'Veja o vídeo curto de como empresas estão aplicando isso e contrate o executor com 1 clique.',
      };
    }
    return {
      title: `Alta demanda em ${tagName} detectada! 📈`,
      body: 'Clientes estão buscando essa solução agora. Dê swipe na pilha para fechar novos contratos em dólar.',
    };
  }

  private async sendBatch(messages: admin.messaging.Message[], userIds: string[]): Promise<void> {
    const BATCH_SIZE = 500; // FCM sendEach hard cap per call
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batchMessages = messages.slice(i, i + BATCH_SIZE);
      const batchUserIds = userIds.slice(i, i + BATCH_SIZE);

      const response = await admin.messaging().sendEach(batchMessages);
      const staleUserIds: string[] = [];
      response.responses.forEach((r, idx) => {
        if (!r.success && this.isTokenInvalid(r.error?.code)) {
          staleUserIds.push(batchUserIds[idx]);
        }
      });

      if (staleUserIds.length > 0) {
        await this.prisma.user.updateMany({
          where: { id: { in: staleUserIds } },
          data: { fcmToken: null },
        });
        this.logger.log(`Cleared ${staleUserIds.length} stale FCM token(s)`);
      }
    }
  }

  private isTokenInvalid(errorCode?: string): boolean {
    return (
      errorCode === 'messaging/registration-token-not-registered' ||
      errorCode === 'messaging/invalid-registration-token'
    );
  }
}
