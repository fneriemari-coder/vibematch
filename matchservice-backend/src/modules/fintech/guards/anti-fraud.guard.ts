import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus, FraudVerdict } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AesEncryption } from '../../../common/security/aes-encryption.util';

interface FraudSignals {
  ip: string;
  deviceId: string | null;
  ipCountry: string | null; // from a CDN-resolved geo header (e.g. Cloudflare's CF-IPCountry) — we never call a geo-IP API ourselves
  gpsCountryHint: string | null; // client reverse-geocodes on-device and sends the ISO country code
  behaviorRiskScore: number | null; // 0-1, produced by a client-side telemetry SDK (keystroke/tap cadence) — consumed here, not computed here
}

/**
 * Anti-fraud gate for financial routes (withdrawals, BNPL financing,
 * receivables advance). Every evaluation — allowed or blocked — is written
 * to FraudCheckLog with the raw device fingerprint AES-256-GCM encrypted,
 * so this guard is itself an audit trail, not just an enforcement point.
 *
 * MUST run after JwtAuthGuard (`@UseGuards(JwtAuthGuard, AntiFraudGuard)`) —
 * it reads `request.user.id` set by the JWT strategy.
 *
 * Honesty note on device fingerprinting: behavioral biometrics (keystroke/tap
 * cadence) are NOT computed here — that requires a client-side telemetry SDK
 * this repo doesn't include; this guard only consumes a risk score if one is
 * sent. IP geolocation has two tiers: if `GEOIP_LOOKUP_URL_TEMPLATE` is
 * configured (a real GeoIP vendor endpoint), it's queried directly; otherwise
 * this falls back to a CDN-resolved geo header (e.g. Cloudflare's
 * CF-IPCountry), which costs nothing extra since most production stacks sit
 * behind such a CDN already. Either way, a lookup failure or an absent signal
 * fails OPEN — not closed — so missing telemetry never blocks a legitimate
 * transaction.
 */
@Injectable()
export class AntiFraudGuard implements CanActivate {
  private readonly logger = new Logger(AntiFraudGuard.name);
  private readonly encryption: AesEncryption;

  private readonly velocityWindowMinutes: number;
  private readonly velocityMaxDistinctProviders: number;
  private readonly identityVolumeThresholdUsd: number;
  private readonly identityVolumeThresholdBrl: number;
  private readonly scoreDropThreshold: number;
  private readonly scoreDropWindowHours: number;
  private readonly slackWebhookUrl?: string;
  private readonly geoipUrlTemplate?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.encryption = new AesEncryption(this.config.get<string>('FRAUD_ENCRYPTION_KEY') ?? 'dev-only-insecure-default-key');
    this.velocityWindowMinutes = Number(this.config.get('ANTI_FRAUD_VELOCITY_WINDOW_MINUTES') ?? '10');
    this.velocityMaxDistinctProviders = Number(this.config.get('ANTI_FRAUD_VELOCITY_MAX_DISTINCT_PROVIDERS') ?? '3');
    this.identityVolumeThresholdUsd = Number(this.config.get('IDENTITY_VOLUME_THRESHOLD_USD') ?? '1000');
    this.identityVolumeThresholdBrl = Number(this.config.get('IDENTITY_VOLUME_THRESHOLD_BRL') ?? '5000');
    this.scoreDropThreshold = Number(this.config.get('IDENTITY_SCORE_DROP_THRESHOLD') ?? '150');
    this.scoreDropWindowHours = Number(this.config.get('IDENTITY_SCORE_DROP_WINDOW_HOURS') ?? '48');
    this.slackWebhookUrl = this.config.get<string>('SLACK_FRAUD_ALERT_WEBHOOK_URL');
    this.geoipUrlTemplate = this.config.get<string>('GEOIP_LOOKUP_URL_TEMPLATE');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const route = `${request.method} ${request.route?.path ?? request.url}`;
    const authUserId: string | undefined = request.user?.id;
    if (!authUserId) {
      throw new ForbiddenException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({ where: { id: authUserId } });
    if (!user) throw new ForbiddenException('User not found');

    const signals = await this.extractSignals(request);

    // --- 1. Frozen account gate ------------------------------------------
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      await this.log(user.id, route, FraudVerdict.BLOCKED, 'ACCOUNT_FROZEN', signals);
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCOUNT_UNDER_REVIEW',
        message: 'This account is under review — financial actions are temporarily frozen.',
      });
    }

    // --- 2. Velocity check (escrow-creation burst across providers) ------
    const velocityBlocked = await this.checkVelocity(user.id);
    if (velocityBlocked) {
      await this.prisma.user.update({ where: { id: user.id }, data: { accountStatus: AccountStatus.UNDER_REVIEW } });
      await this.log(user.id, route, FraudVerdict.BLOCKED, 'VELOCITY_ANOMALY', signals);
      await this.alertSlack(
        `🚨 *Anti-fraud freeze* — user \`${user.id}\` (${user.email}) created more than ` +
          `${this.velocityMaxDistinctProviders} escrow contracts with distinct providers in under ` +
          `${this.velocityWindowMinutes} minutes. Account frozen (UNDER_REVIEW). Route: ${route}.`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        code: 'VELOCITY_ANOMALY',
        message: 'Unusual account activity detected — this account has been frozen pending review.',
      });
    }

    // --- 3. Geo/device discrepancy ----------------------------------------
    if (this.hasAbruptGeoDiscrepancy(user.country, signals)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { accountStatus: AccountStatus.UNDER_REVIEW } });
      await this.log(user.id, route, FraudVerdict.BLOCKED, 'GEO_DISCREPANCY', signals);
      await this.alertSlack(
        `🚨 *Anti-fraud block* — user \`${user.id}\` (${user.email}) declared country ${user.country} but ` +
          `IP (${signals.ipCountry}) and GPS (${signals.gpsCountryHint}) both disagree. Account frozen. Route: ${route}.`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        code: 'GEO_DISCREPANCY',
        message: 'Location verification failed for this transaction. Your account has been placed under review.',
      });
    }

    // --- 4. Identity verification requirement ------------------------------
    const identityRequired = await this.requiresIdentityVerification(user.id, user.country);
    if (identityRequired && !user.identityVerified) {
      await this.log(user.id, route, FraudVerdict.BLOCKED, 'IDENTITY_VERIFICATION_REQUIRED', signals);
      throw new ForbiddenException({
        statusCode: 403,
        code: 'IDENTITY_VERIFICATION_REQUIRED',
        message: 'Please complete identity verification before continuing.',
        verifyUrl: '/fintech/verify-identity',
      });
    }

    await this.log(user.id, route, FraudVerdict.ALLOWED, null, signals);
    return true;
  }

  private async extractSignals(request: any): Promise<FraudSignals> {
    const ip: string =
      request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      request.ip ||
      request.socket?.remoteAddress ||
      'unknown';

    const deviceId = (request.headers['x-device-id'] as string) || null;
    const headerIpCountry = (request.headers['cf-ipcountry'] as string) || null;
    const ipCountry = (await this.resolveRealIpCountry(ip)) ?? headerIpCountry;
    const gpsCountryHint = (request.body?.gpsCountryHint as string) || null;
    const rawRiskScore = request.headers['x-behavior-risk-score'] ?? request.body?.behaviorRiskScore;
    const behaviorRiskScore = rawRiskScore !== undefined ? Number(rawRiskScore) : null;

    return { ip, deviceId, ipCountry, gpsCountryHint, behaviorRiskScore: Number.isNaN(behaviorRiskScore) ? null : behaviorRiskScore };
  }

  /**
   * Real GeoIP lookup — only attempted when GEOIP_LOOKUP_URL_TEMPLATE is
   * configured (a `{ip}`-templated vendor endpoint returning a bare
   * ISO-3166 country code, e.g. `https://ipapi.co/{ip}/country/`). Any
   * failure (timeout, non-2xx, malformed body, unset config) returns null
   * and the CDN-header fallback takes over — this must never throw.
   */
  private async resolveRealIpCountry(ip: string): Promise<string | null> {
    if (!this.geoipUrlTemplate || ip === 'unknown') return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const url = this.geoipUrlTemplate.replace('{ip}', encodeURIComponent(ip));
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const body = (await response.text()).trim().toUpperCase();
      return /^[A-Z]{2}$/.test(body) ? body : null;
    } catch (err) {
      this.logger.debug(`GeoIP lookup failed for ${ip}, falling back to CDN header: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private hasAbruptGeoDiscrepancy(declaredCountry: string, signals: FraudSignals): boolean {
    // Require BOTH independent signals to be present AND both to disagree
    // with the declared country — a single noisy signal (VPN, imprecise CDN
    // edge) is not enough evidence to freeze a real user's account.
    if (!signals.ipCountry || !signals.gpsCountryHint) return false;
    return signals.ipCountry !== declaredCountry && signals.gpsCountryHint !== declaredCountry;
  }

  private async checkVelocity(clientId: string): Promise<boolean> {
    const since = new Date(Date.now() - this.velocityWindowMinutes * 60 * 1000);
    const recentProjects = await this.prisma.escrowProject.findMany({
      where: { clientId, createdAt: { gte: since } },
      select: { providerId: true },
    });
    const distinctProviders = new Set(recentProjects.map((p) => p.providerId));
    return distinctProviders.size > this.velocityMaxDistinctProviders;
  }

  private async requiresIdentityVerification(userId: string, country: string): Promise<boolean> {
    const [volumeAgg, score] = await Promise.all([
      this.prisma.walletTransaction.aggregate({
        where: { userId, amount: { gt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.providerScore.findUnique({ where: { providerId: userId } }),
    ]);

    const cumulativeVolume = Number(volumeAgg._sum.amount ?? 0);
    const threshold = country === 'BR' ? this.identityVolumeThresholdBrl : this.identityVolumeThresholdUsd;
    if (cumulativeVolume > threshold) return true;

    if (score?.previousScoreAt && score.previousFinancialHealthScore !== null) {
      const hoursSinceDrop = (Date.now() - score.previousScoreAt.getTime()) / (60 * 60 * 1000);
      const drop = score.previousFinancialHealthScore - score.financialHealthScore;
      if (hoursSinceDrop <= this.scoreDropWindowHours && drop >= this.scoreDropThreshold) {
        return true;
      }
    }

    return false;
  }

  private async log(
    userId: string,
    route: string,
    verdict: FraudVerdict,
    reasonCode: string | null,
    signals: FraudSignals,
  ): Promise<void> {
    try {
      const encryptedPayload = this.encryption.encrypt(JSON.stringify(signals));
      await this.prisma.fraudCheckLog.create({
        data: { userId, route, verdict, reasonCode, encryptedPayload },
      });
    } catch (err) {
      // Audit logging must never be the reason a legitimate request fails,
      // nor silently swallow a block decision — we've already decided the
      // verdict above; this only protects the *record* of that decision.
      this.logger.error(`Failed to write FraudCheckLog for user ${userId} on ${route}: ${(err as Error).message}`);
    }
  }

  private async alertSlack(message: string): Promise<void> {
    if (!this.slackWebhookUrl) {
      this.logger.warn(`SLACK_FRAUD_ALERT_WEBHOOK_URL not set — alert not sent: ${message}`);
      return;
    }
    try {
      await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
    } catch (err) {
      this.logger.error(`Slack fraud alert failed to send: ${(err as Error).message}`);
    }
  }
}
