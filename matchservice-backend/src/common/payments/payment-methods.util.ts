import type Stripe from 'stripe';
import { Currency } from '@prisma/client';

/**
 * Which payment methods a one-off Checkout Session should offer.
 *
 * The webhook side already handles `checkout.session.async_payment_succeeded`,
 * but nothing ever asked Stripe for an asynchronous method — so that handler
 * was correct code that could never fire, and every Brazilian buyer was funnelled
 * into a card. Boleto and Pix are how a large share of this market actually
 * pays; offering only cards silently loses those sales rather than failing them.
 *
 * Two hard constraints from Stripe, both of which make this conditional rather
 * than a constant:
 *
 * - Boleto and Pix require BRL. Attaching them to a USD session is rejected
 *   outright, so a US buyer must still get the card-only list.
 * - Neither works in `mode: 'subscription'`. Recurring charges need a method
 *   Stripe can debit again without the customer present, which a one-shot
 *   boleto is not. Subscription flows must not call this.
 *
 * Both methods also have to be enabled in the Stripe Dashboard for the account
 * (Settings → Payment methods). Until they are, Stripe ignores the ones it does
 * not recognise and the session still works with cards — so shipping this is
 * safe ahead of that switch being flipped.
 */
export function oneOffPaymentMethods(
  currency: Currency,
): Stripe.Checkout.SessionCreateParams.PaymentMethodType[] {
  return currency === Currency.BRL ? ['card', 'boleto', 'pix'] : ['card'];
}

/**
 * How long an asynchronous method may stay unpaid before Stripe expires it.
 *
 * Boleto's default is three days, which leaves a course purchase or an escrow
 * deposit in limbo for most of a week. One day matches how people actually pay
 * a boleto they intend to honour, and keeps the pending state short enough that
 * the buyer still remembers making it.
 */
export const ASYNC_PAYMENT_EXPIRY_DAYS = 1;

export function boletoOptions(
  currency: Currency,
): Stripe.Checkout.SessionCreateParams.PaymentMethodOptions | undefined {
  if (currency !== Currency.BRL) return undefined;
  return { boleto: { expires_after_days: ASYNC_PAYMENT_EXPIRY_DAYS } };
}
