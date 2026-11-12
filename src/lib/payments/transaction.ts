// The order lifecycle after an offer is accepted: payment, purchase, journey, delivery, payout, and what happens when
// something goes wrong. Pure and deterministic: no database, no provider, no clock. Real money is switched off
// (src/lib/payments/flags.ts); this only defines which steps can follow which, and who may take each one.
//
// Rules this file enforces:
// - Money-moving facts (payment confirmed, refund done, payout done, chargeback) come only from the payment provider,
//   through a verified webhook. A buyer can't confirm a payment and a traveller can't release their own payout.
// - Amounts reported by the provider must match the amounts fixed when the offer was accepted.
// - An open dispute or a chargeback blocks both payout and refund until an admin decides.
// - No step happens because time passed: unanswered or unclear cases go to manual review, never to an automatic outcome.
// - Every event has an id. Replaying the same event (a webhook delivered twice) changes nothing.
import type { JourneyDirection } from "@/lib/journey";

export const MAIN_PATH = [
  "OFFER_ACCEPTED",
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "TRAVELLER_PURCHASE_PENDING",
  "PURCHASE_CONFIRMED",
  "IN_TRANSIT",
  "DELIVERY_PENDING",
  "DELIVERED",
  "BUYER_CONFIRMATION_PENDING",
  "PAYOUT_ELIGIBLE",
  "PAYOUT_PROCESSING",
  "PAYOUT_COMPLETED",
] as const;

export const EXCEPTION_STATES = [
  "PAYMENT_FAILED",
  "PAYMENT_CANCELLED",
  "ORDER_CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
  "DISPUTE_OPEN",
  "DISPUTE_UNDER_REVIEW",
  "DISPUTE_RESOLVED",
  "PAYOUT_FAILED",
  "MANUAL_REVIEW_REQUIRED",
] as const;

export type TransactionState = (typeof MAIN_PATH)[number] | (typeof EXCEPTION_STATES)[number];
export const ALL_STATES: readonly TransactionState[] = [...MAIN_PATH, ...EXCEPTION_STATES];

/** Nothing follows these except a provider-reported chargeback, which always needs a person to look at it. */
export const FINAL_STATES: readonly TransactionState[] = ["PAYOUT_COMPLETED", "REFUNDED", "ORDER_CANCELLED"];

/**
 * Who is acting. `provider` means a webhook whose signature was verified on the server; `system` means Orbitly's own
 * server code; `admin` means a person on Orbitly's review team. Buyers and travellers only act on their own orders.
 */
export type Actor = { role: "buyer" | "traveller"; userId: string } | { role: "provider" | "system" | "admin" };
type Role = Actor["role"];

export type DisputeResolution = "refund_buyer" | "pay_traveller";

export type TransactionEventType =
  | "request_payment"
  | "payment_confirmed"
  | "payment_failed"
  | "retry_payment"
  | "cancel_payment"
  | "cancel_order"
  | "request_purchase"
  | "confirm_purchase"
  | "report_cannot_purchase"
  | "start_transit"
  | "arrive"
  | "record_delivery"
  | "request_buyer_confirmation"
  | "buyer_confirms_delivery"
  | "flag_no_buyer_response"
  | "start_payout"
  | "payout_completed"
  | "payout_failed"
  | "open_dispute"
  | "review_dispute"
  | "resolve_dispute"
  | "initiate_refund"
  | "refund_completed"
  | "refund_failed"
  | "approve_payout"
  | "chargeback"
  | "require_manual_review";

/** What a caller submits. `id` must be unique per event (for webhooks, the provider's own event id). */
export type TransactionEventInput = {
  id: string;
  type: TransactionEventType;
  actor: Actor;
  /** ISO time, supplied by the caller so this module stays deterministic. */
  at: string;
  /** Ids of uploaded files (receipts, photos). Required where a step depends on evidence. */
  evidence?: string[];
  /** Provider-reported amount in minor units, for payment, refund and payout confirmations. */
  amountMinor?: number;
  currency?: string;
  resolution?: DisputeResolution;
  note?: string;
};

/** `unexpected`: a provider outcome that arrived when the order was in a state that didn't expect it (see applyEvent). */
export type TransactionEvent = Readonly<TransactionEventInput & { from: TransactionState; to: TransactionState; unexpected?: boolean }>;

export type Transaction = Readonly<{
  id: string;
  direction: JourneyDirection;
  buyerId: string;
  travellerId: string;
  /** The accepted-price snapshot this order was priced from. Amounts below are copied from it, never recalculated. */
  pricingSnapshotId: string;
  currency: "INR";
  /** What the buyer pays in total (the snapshot's buyer total), in paise. */
  amountDueMinor: number;
  /**
   * What the traveller receives, in paise. P0 OPEN: currently the snapshot's net reward only, which leaves out the
   * product cost the traveller paid. The correct amount depends on founder decisions D1–D10 (docs/payments/financial-flow.md).
   */
  payoutAmountMinor: number;
  state: TransactionState;
  disputeResolution: DisputeResolution | null;
  /** Set when the provider reports a chargeback or reversal. Blocks payouts until an admin clears the order. */
  chargeback: boolean;
  /** Append-only. Each event records where it moved the order from and to. */
  history: readonly TransactionEvent[];
}>;

export type TransitionError =
  | "unknown_event"
  | "invalid_transition"
  | "role_not_allowed"
  | "not_a_party"
  | "evidence_required"
  | "amount_mismatch"
  | "resolution_required"
  | "blocked_by_dispute"
  | "blocked_by_chargeback"
  | "event_id_conflict"
  | "duplicate_payout"
  | "duplicate_refund"
  | "operation_missing"
  | "payment_attempt_open"
  | "invalid_event";

export type TransitionResult =
  | { ok: true; transaction: Transaction; duplicate: boolean }
  | { ok: false; error: TransitionError; message: string };

type Rule = {
  from: readonly TransactionState[];
  to: TransactionState;
  roles: readonly Role[];
  evidence?: true;
  /** Which amount a provider confirmation must match. */
  amount?: "due" | "payout";
};

// States in which the buyer's money has been collected by the provider and not yet refunded or paid out.
const FUNDS_COLLECTED: readonly TransactionState[] = [
  "PAYMENT_CONFIRMED",
  "TRAVELLER_PURCHASE_PENDING",
  "PURCHASE_CONFIRMED",
  "IN_TRANSIT",
  "DELIVERY_PENDING",
  "DELIVERED",
  "BUYER_CONFIRMATION_PENDING",
  "PAYOUT_ELIGIBLE",
  "DISPUTE_OPEN",
  "DISPUTE_UNDER_REVIEW",
  "DISPUTE_RESOLVED",
  "MANUAL_REVIEW_REQUIRED",
];

// Where a buyer or traveller can raise a problem: after payment, before the payout is under way.
const DISPUTABLE: readonly TransactionState[] = [
  "PAYMENT_CONFIRMED",
  "TRAVELLER_PURCHASE_PENDING",
  "PURCHASE_CONFIRMED",
  "IN_TRANSIT",
  "DELIVERY_PENDING",
  "DELIVERED",
  "BUYER_CONFIRMATION_PENDING",
  "PAYOUT_ELIGIBLE",
];

export const RULES: Readonly<Record<TransactionEventType, Rule>> = {
  request_payment: { from: ["OFFER_ACCEPTED"], to: "PAYMENT_PENDING", roles: ["system"] },
  payment_confirmed: { from: ["PAYMENT_PENDING"], to: "PAYMENT_CONFIRMED", roles: ["provider"], amount: "due" },
  payment_failed: { from: ["PAYMENT_PENDING"], to: "PAYMENT_FAILED", roles: ["provider"] },
  retry_payment: { from: ["PAYMENT_FAILED", "PAYMENT_CANCELLED"], to: "PAYMENT_PENDING", roles: ["system"] },
  cancel_payment: { from: ["PAYMENT_PENDING"], to: "PAYMENT_CANCELLED", roles: ["buyer", "provider"] },
  // Only before any money is collected. Cancelling after payment is a refund decision, made by a person.
  cancel_order: { from: ["OFFER_ACCEPTED", "PAYMENT_FAILED", "PAYMENT_CANCELLED"], to: "ORDER_CANCELLED", roles: ["buyer", "traveller", "admin"] },
  request_purchase: { from: ["PAYMENT_CONFIRMED"], to: "TRAVELLER_PURCHASE_PENDING", roles: ["system"] },
  confirm_purchase: { from: ["TRAVELLER_PURCHASE_PENDING"], to: "PURCHASE_CONFIRMED", roles: ["traveller"], evidence: true },
  // Unavailable, price changed, trip cancelled: the right outcome depends on the case, so a person decides.
  report_cannot_purchase: { from: ["TRAVELLER_PURCHASE_PENDING"], to: "MANUAL_REVIEW_REQUIRED", roles: ["traveller"] },
  start_transit: { from: ["PURCHASE_CONFIRMED"], to: "IN_TRANSIT", roles: ["traveller"] },
  arrive: { from: ["IN_TRANSIT"], to: "DELIVERY_PENDING", roles: ["traveller"] },
  record_delivery: { from: ["DELIVERY_PENDING"], to: "DELIVERED", roles: ["traveller"], evidence: true },
  request_buyer_confirmation: { from: ["DELIVERED"], to: "BUYER_CONFIRMATION_PENDING", roles: ["system"] },
  buyer_confirms_delivery: { from: ["BUYER_CONFIRMATION_PENDING"], to: "PAYOUT_ELIGIBLE", roles: ["buyer"] },
  // No deadline is assumed here: when (and whether) a silent buyer is flagged is a policy still to be approved.
  flag_no_buyer_response: { from: ["BUYER_CONFIRMATION_PENDING"], to: "MANUAL_REVIEW_REQUIRED", roles: ["system", "admin"] },
  // Payouts are started by Orbitly's review team, never by the traveller and never by a page.
  start_payout: { from: ["PAYOUT_ELIGIBLE", "PAYOUT_FAILED"], to: "PAYOUT_PROCESSING", roles: ["admin"] },
  payout_completed: { from: ["PAYOUT_PROCESSING"], to: "PAYOUT_COMPLETED", roles: ["provider"], amount: "payout" },
  payout_failed: { from: ["PAYOUT_PROCESSING"], to: "PAYOUT_FAILED", roles: ["provider"] },
  open_dispute: { from: DISPUTABLE, to: "DISPUTE_OPEN", roles: ["buyer", "traveller"] },
  review_dispute: { from: ["DISPUTE_OPEN"], to: "DISPUTE_UNDER_REVIEW", roles: ["admin"] },
  resolve_dispute: { from: ["DISPUTE_UNDER_REVIEW"], to: "DISPUTE_RESOLVED", roles: ["admin"] },
  initiate_refund: { from: ["DISPUTE_RESOLVED", "MANUAL_REVIEW_REQUIRED"], to: "REFUND_PENDING", roles: ["admin"] },
  refund_completed: { from: ["REFUND_PENDING"], to: "REFUNDED", roles: ["provider"], amount: "due" },
  refund_failed: { from: ["REFUND_PENDING"], to: "MANUAL_REVIEW_REQUIRED", roles: ["provider"] },
  approve_payout: { from: ["DISPUTE_RESOLVED", "MANUAL_REVIEW_REQUIRED"], to: "PAYOUT_ELIGIBLE", roles: ["admin"] },
  chargeback: { from: [...FUNDS_COLLECTED, "PAYOUT_PROCESSING", "PAYOUT_FAILED", "PAYOUT_COMPLETED", "REFUND_PENDING", "REFUNDED"], to: "MANUAL_REVIEW_REQUIRED", roles: ["provider"] },
  require_manual_review: {
    from: ALL_STATES.filter((s) => !FINAL_STATES.includes(s) && s !== "MANUAL_REVIEW_REQUIRED"),
    to: "MANUAL_REVIEW_REQUIRED",
    roles: ["system", "admin"],
  },
};

const fail = (error: TransitionError, message: string): TransitionResult => ({ ok: false, error, message });

/**
 * Whether money has already been sent one way or the other: a payout or refund was started and didn't fail
 * afterwards. Checked from history, not from the current state, because a stuck payout can pass through manual review
 * and must never be started a second time from there.
 */
function moneyMoving(tx: Transaction, start: TransactionEventType, failed: TransactionEventType): boolean {
  let moving = false;
  for (const e of tx.history) {
    if (e.type === start) moving = true;
    else if (e.type === failed) moving = false;
  }
  return moving;
}
export const payoutStarted = (tx: Transaction) => moneyMoving(tx, "start_payout", "payout_failed");
export const refundStarted = (tx: Transaction) => moneyMoving(tx, "initiate_refund", "refund_failed");

type AttemptKind = "payment" | "refund" | "payout";
const ATTEMPT_START: Partial<Record<TransactionEventType, AttemptKind>> = {
  request_payment: "payment", retry_payment: "payment", start_payout: "payout", initiate_refund: "refund",
};
/** A provider's answer to an attempt: which kind it settles, and whether money moved. */
export const OUTCOMES: Partial<Record<TransactionEventType, { kind: AttemptKind; success: boolean }>> = {
  payment_confirmed: { kind: "payment", success: true },
  payment_failed: { kind: "payment", success: false },
  cancel_payment: { kind: "payment", success: false },
  payout_completed: { kind: "payout", success: true },
  payout_failed: { kind: "payout", success: false },
  refund_completed: { kind: "refund", success: true },
  refund_failed: { kind: "refund", success: false },
};

/**
 * Whether an attempt of this kind is still open at the provider: started, and not yet answered by the provider. A
 * buyer cancelling a payment doesn't close it, because the provider may still capture the money.
 */
export function liveAttempt(tx: Transaction, kind: AttemptKind): boolean {
  let live = false;
  for (const e of tx.history) {
    if (ATTEMPT_START[e.type] === kind) live = true;
    else if (e.actor.role === "provider" && OUTCOMES[e.type]?.kind === kind) live = false;
  }
  return live;
}

/** A new order at the moment its offer is accepted. Amounts come from the accepted-price snapshot. */
export function createTransaction(input: Omit<Transaction, "state" | "disputeResolution" | "chargeback" | "history">): Transaction {
  if (!input.id || !input.buyerId || !input.travellerId || !input.pricingSnapshotId) throw new Error("Transaction ids are required.");
  if (input.buyerId === input.travellerId) throw new Error("A buyer can't carry their own order.");
  if (!Number.isSafeInteger(input.amountDueMinor) || input.amountDueMinor <= 0) throw new Error("Amount due must be a positive whole number of paise.");
  if (!Number.isSafeInteger(input.payoutAmountMinor) || input.payoutAmountMinor <= 0) throw new Error("Payout must be a positive whole number of paise.");
  if (input.payoutAmountMinor >= input.amountDueMinor) throw new Error("The payout can't be more than the buyer pays.");
  return Object.freeze({ ...input, state: "OFFER_ACCEPTED", disputeResolution: null, chargeback: false, history: Object.freeze([]) });
}

/**
 * Applies one event. Never mutates: returns the next transaction, or why the event was refused. Callers must persist
 * the result atomically and must check `actor` themselves (a session for buyers and travellers, a verified signature
 * for the provider); this function trusts the role it's given and checks everything else.
 */
export function applyEvent(tx: Transaction, event: TransactionEventInput): TransitionResult {
  if (typeof event.id !== "string" || !event.id.trim() || typeof event.at !== "string") return fail("invalid_event", "Every event needs an id and a time.");

  // Idempotency: the same event delivered again is a no-op; a different event reusing an id is refused.
  const seen = tx.history.find((e) => e.id === event.id);
  if (seen) {
    if (seen.type !== event.type || seen.actor.role !== event.actor.role) return fail("event_id_conflict", "That event id was already used for a different event.");
    return { ok: true, transaction: tx, duplicate: true };
  }

  const rule = Object.hasOwn(RULES, event.type) ? RULES[event.type] : undefined;
  if (!rule) return fail("unknown_event", "That isn't a step Orbitly knows.");
  if (!rule.roles.includes(event.actor.role)) return fail("role_not_allowed", `A ${event.actor.role} can't take this step.`);
  if (event.actor.role === "buyer" && event.actor.userId !== tx.buyerId) return fail("not_a_party", "Only this order's buyer can take this step.");
  if (event.actor.role === "traveller" && event.actor.userId !== tx.travellerId) return fail("not_a_party", "Only this order's traveller can take this step.");
  // A provider's outcome is a fact about money and is never dropped: it settles the attempt still open, whatever
  // state the order is in. Unexpected success (money moved) sends the order to review; unexpected failure leaves it.
  const outcome = event.actor.role === "provider" ? OUTCOMES[event.type] : undefined;
  let to = rule.to;
  let unexpected = false;
  if (outcome) {
    if (!liveAttempt(tx, outcome.kind)) return fail("operation_missing", `No ${outcome.kind} attempt is open for this answer.`);
    if (!rule.from.includes(tx.state)) {
      unexpected = true;
      to = outcome.success ? "MANUAL_REVIEW_REQUIRED" : tx.state;
    }
  } else if (!rule.from.includes(tx.state)) {
    return fail("invalid_transition", `Can't ${event.type.replaceAll("_", " ")} from ${tx.state}.`);
  }
  // While a payment attempt is open the buyer could still be charged, so no new attempt and no cancellation yet.
  if ((event.type === "retry_payment" || event.type === "cancel_order") && liveAttempt(tx, "payment")) {
    return fail("payment_attempt_open", "The last payment attempt hasn't been closed by the provider yet.");
  }
  if (rule.evidence && !(Array.isArray(event.evidence) && event.evidence.some((e) => typeof e === "string" && e.trim()))) {
    return fail("evidence_required", "This step needs evidence, such as a receipt or a photo.");
  }
  if (rule.amount) {
    const expected = rule.amount === "due" ? tx.amountDueMinor : tx.payoutAmountMinor;
    if (event.amountMinor !== expected || event.currency !== tx.currency) return fail("amount_mismatch", "The provider's amount doesn't match this order.");
  }

  // Money only moves when nothing is contested.
  // Never both, never twice: one payout or one refund per order, each only after the other has been ruled out.
  if (event.type === "start_payout" || event.type === "approve_payout") {
    if (tx.chargeback) return fail("blocked_by_chargeback", "A chargeback is open on this order.");
    if (payoutStarted(tx)) return fail("duplicate_payout", "A payout has already been started for this order.");
    if (refundStarted(tx)) return fail("duplicate_refund", "This order is being refunded, so it can't be paid out.");
    if (tx.state === "DISPUTE_RESOLVED" && tx.disputeResolution !== "pay_traveller") return fail("blocked_by_dispute", "The dispute wasn't resolved in the traveller's favour.");
  }
  if (event.type === "initiate_refund") {
    if (tx.chargeback) return fail("blocked_by_chargeback", "The provider already reversed this payment.");
    if (refundStarted(tx)) return fail("duplicate_refund", "A refund has already been started for this order.");
    if (payoutStarted(tx)) return fail("duplicate_payout", "The traveller's payout was already started, so a person must handle this.");
    if (tx.state === "DISPUTE_RESOLVED" && tx.disputeResolution !== "refund_buyer") return fail("blocked_by_dispute", "The dispute wasn't resolved with a refund.");
  }
  if (event.type === "resolve_dispute" && event.resolution !== "refund_buyer" && event.resolution !== "pay_traveller") {
    return fail("resolution_required", "Resolving a dispute needs an outcome.");
  }

  const recorded: TransactionEvent = Object.freeze({
    ...event,
    evidence: event.evidence ? (Object.freeze([...event.evidence]) as string[]) : undefined,
    from: tx.state,
    to,
    ...(unexpected ? { unexpected: true } : {}),
  });
  return {
    ok: true,
    duplicate: false,
    transaction: Object.freeze({
      ...tx,
      state: to,
      disputeResolution: event.type === "resolve_dispute" ? event.resolution! : event.type === "open_dispute" ? null : tx.disputeResolution,
      chargeback: tx.chargeback || event.type === "chargeback",
      history: Object.freeze([...tx.history, recorded]),
    }),
  };
}

/** The steps a given actor could take now. For showing or hiding controls; `applyEvent` still decides. */
export function availableEvents(tx: Transaction, role: Role): TransactionEventType[] {
  return (Object.keys(RULES) as TransactionEventType[]).filter((t) => RULES[t].roles.includes(role) && RULES[t].from.includes(tx.state));
}

/**
 * Plain-language status for each side. "Paid", "refunded" and "received" appear only for states the provider has
 * confirmed; everything else describes what's happening, not an outcome.
 */
export const STATE_LABEL: Readonly<Record<TransactionState, { buyer: string; traveller: string }>> = {
  OFFER_ACCEPTED: { buyer: "Offer accepted", traveller: "Your offer was accepted" },
  PAYMENT_PENDING: { buyer: "Waiting for your payment", traveller: "Waiting for the buyer’s payment" },
  PAYMENT_CONFIRMED: { buyer: "Payment confirmed by the payment provider", traveller: "Buyer’s payment confirmed by the payment provider" },
  TRAVELLER_PURCHASE_PENDING: { buyer: "Waiting for the traveller to buy the item", traveller: "Buy the item and add your receipt" },
  PURCHASE_CONFIRMED: { buyer: "Traveller bought the item and shared the receipt", traveller: "Purchase evidence submitted" },
  IN_TRANSIT: { buyer: "On its way with the traveller", traveller: "In transit" },
  DELIVERY_PENDING: { buyer: "Traveller has arrived; hand-over to arrange", traveller: "Arrange the hand-over" },
  DELIVERED: { buyer: "Hand-over recorded by the traveller", traveller: "Delivery evidence submitted" },
  BUYER_CONFIRMATION_PENDING: { buyer: "Please confirm you received the item", traveller: "Waiting for the buyer to confirm" },
  PAYOUT_ELIGIBLE: { buyer: "You confirmed delivery", traveller: "Payout eligible; not yet sent" },
  PAYOUT_PROCESSING: { buyer: "Order complete", traveller: "Payout processing with the payment provider" },
  PAYOUT_COMPLETED: { buyer: "Order complete", traveller: "Payout confirmed by the payment provider" },
  PAYMENT_FAILED: { buyer: "Payment didn’t go through", traveller: "Buyer’s payment didn’t go through" },
  PAYMENT_CANCELLED: { buyer: "Payment cancelled", traveller: "Buyer cancelled the payment" },
  ORDER_CANCELLED: { buyer: "Order cancelled", traveller: "Order cancelled" },
  REFUND_PENDING: { buyer: "Refund requested from the payment provider", traveller: "Order being refunded" },
  REFUNDED: { buyer: "Refund confirmed by the payment provider", traveller: "Order refunded" },
  DISPUTE_OPEN: { buyer: "Problem reported", traveller: "Problem reported" },
  DISPUTE_UNDER_REVIEW: { buyer: "Orbitly is reviewing the problem", traveller: "Orbitly is reviewing the problem" },
  DISPUTE_RESOLVED: { buyer: "Review finished", traveller: "Review finished" },
  PAYOUT_FAILED: { buyer: "Order complete", traveller: "Payout didn’t go through; Orbitly will retry or contact you" },
  MANUAL_REVIEW_REQUIRED: { buyer: "Orbitly is reviewing this order", traveller: "Orbitly is reviewing this order" },
};
