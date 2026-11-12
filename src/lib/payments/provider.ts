import "server-only";
import { PAYMENTS_UNAVAILABLE } from "./flags";
import type { Transaction } from "./transaction";

// The only door to a payment provider. Orbitly never holds customer money itself: collection, any delayed settlement,
// refunds and payouts are the provider's, under its licence and agreement. No adapter is approved yet, so the only
// implementation is the disabled one below, which refuses everything and never reports a success.

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; code: "payments_disabled" | "not_supported" | "provider_error"; message: string };

/** Provider-side status, in the provider's terms. Only `captured`, `refunded` and `paid_out` confirm money moved. */
export type ProviderPaymentStatus = "created" | "pending" | "captured" | "failed" | "cancelled" | "refund_pending" | "refunded" | "reversed";
export type ProviderPayoutStatus = "pending" | "processing" | "paid_out" | "failed";

/** What a provider says about one payment, used for reconciliation. Amounts in minor units. */
export type ProviderPaymentRecord = { orderRef: string; status: ProviderPaymentStatus; amountMinor: number; currency: string };

export interface PaymentProvider {
  readonly name: string;
  /** Starts a payment for the snapshot's buyer total. `idempotencyKey` makes a retried request create nothing new. */
  createPayment(input: { transactionId: string; amountMinor: number; currency: "INR"; idempotencyKey: string }): Promise<ProviderResult<{ providerPaymentId: string; checkoutUrl: string }>>;
  /** Asks the provider (server to server) whether a payment really was captured. Never trusts a browser redirect. */
  verifyPayment(input: { providerPaymentId: string; expectedAmountMinor: number; currency: "INR" }): Promise<ProviderResult<ProviderPaymentRecord>>;
  getPaymentStatus(providerPaymentId: string): Promise<ProviderResult<ProviderPaymentRecord>>;
  initiateRefund(input: { providerPaymentId: string; amountMinor: number; idempotencyKey: string }): Promise<ProviderResult<{ providerRefundId: string }>>;
  getRefundStatus(providerRefundId: string): Promise<ProviderResult<{ status: "pending" | "refunded" | "failed" }>>;
  initiatePayout(input: { transactionId: string; travellerAccountRef: string; amountMinor: number; idempotencyKey: string }): Promise<ProviderResult<{ providerPayoutId: string }>>;
  getPayoutStatus(providerPayoutId: string): Promise<ProviderResult<{ status: ProviderPayoutStatus }>>;
  /** Checks a webhook's signature with the provider's own scheme. Unverified webhooks must be dropped. */
  verifyWebhook(input: { rawBody: string; headers: Record<string, string | undefined> }): Promise<ProviderResult<{ eventId: string; type: string; data: unknown }>>;
  reconcileTransaction(transaction: Transaction, providerPaymentId: string): Promise<ProviderResult<string[]>>;
}

// `never`: a refusal can stand in for any operation's result, and can't carry a success value.
const disabled = (): Promise<ProviderResult<never>> => Promise.resolve({ ok: false, code: "payments_disabled", message: PAYMENTS_UNAVAILABLE });

/** Refuses every operation. Never pretends a payment, refund or payout happened. */
export const disabledProvider: PaymentProvider = Object.freeze({
  name: "disabled",
  createPayment: () => disabled(),
  verifyPayment: () => disabled(),
  getPaymentStatus: () => disabled(),
  initiateRefund: () => disabled(),
  getRefundStatus: () => disabled(),
  initiatePayout: () => disabled(),
  getPayoutStatus: () => disabled(),
  verifyWebhook: () => disabled(),
  reconcileTransaction: () => disabled(),
});

/**
 * The provider to use: always the disabled one, whatever PAYMENTS_ENABLED says, because no adapter exists.
 * shortcut: add an adapter (behind its own review) once a provider is approved, and return it only when
 * PAYMENTS_ENABLED is true.
 */
export function getPaymentProvider(): PaymentProvider {
  return disabledProvider;
}

/**
 * Compares the provider's record of a payment with Orbitly's order. Returns every mismatch (empty when they agree).
 * A non-empty result means the order goes to manual review; it never "corrects" either side automatically.
 */
export function reconcilePayment(tx: Transaction, record: ProviderPaymentRecord): string[] {
  const issues: string[] = [];
  if (record.orderRef !== tx.id) issues.push("The payment belongs to a different order.");
  if (record.currency !== tx.currency) issues.push(`Currency ${record.currency} doesn't match ${tx.currency}.`);
  if (record.amountMinor !== tx.amountDueMinor) issues.push(`Amount ${record.amountMinor} doesn't match ${tx.amountDueMinor}.`);
  const paidStates = ["PAYMENT_CONFIRMED", "TRAVELLER_PURCHASE_PENDING", "PURCHASE_CONFIRMED", "IN_TRANSIT", "DELIVERY_PENDING", "DELIVERED", "BUYER_CONFIRMATION_PENDING", "PAYOUT_ELIGIBLE", "PAYOUT_PROCESSING", "PAYOUT_COMPLETED", "PAYOUT_FAILED"];
  const orderSaysPaid = paidStates.includes(tx.state);
  if (orderSaysPaid && record.status !== "captured") issues.push(`Order is ${tx.state} but the provider says ${record.status}.`);
  if (!orderSaysPaid && record.status === "captured" && !tx.history.some((e) => e.type === "payment_confirmed")) {
    issues.push("The provider captured a payment this order never recorded.");
  }
  return issues;
}
