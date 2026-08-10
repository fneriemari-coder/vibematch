import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Sends verification/reset emails via real SMTP when configured. With no
 * SMTP_HOST set (the default for local/dev), it does NOT pretend to have
 * sent anything — it logs the full content at `warn` so the link is still
 * usable for manual testing, and callers/tests should not treat a resolved
 * promise here as proof an inbox was reached.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    this.fromAddress = this.config.get('SMTP_FROM') ?? 'no-reply@matchservice.dev';
    const host = this.config.get<string>('SMTP_HOST');
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: Number(this.config.get('SMTP_PORT') ?? 587),
          secure: this.config.get('SMTP_SECURE') === 'true',
          auth: this.config.get('SMTP_USER')
            ? { user: this.config.get('SMTP_USER'), pass: this.config.get('SMTP_PASS') }
            : undefined,
        })
      : null;
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(
        `SMTP_HOST not set — email NOT sent. Would have sent to ${to} | subject: "${subject}" | body:\n${text}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.fromAddress, to, subject, text });
    } catch (err) {
      // Never let a flaky mail provider break register/login/reset flows —
      // the token still exists in the DB and can be resent.
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }
}
