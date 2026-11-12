// Phase A of buyer protection: the order lifecycle, the disabled provider, webhook helpers and the payments switch.
// No database, no provider, no network. Real money stays off.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAYMENTS_ENABLED } from "@/lib/payments/flags";
import { disabledProvider, getPaymentProvider, reconcilePayment } from "@/lib/payments/provider";
import {
  ALL_STATES,
  applyEvent,
  availableEvents,
  createTransaction,
  FINAL_STATES,
  MAIN_PATH,
  RULES,
  STATE_LABEL,
  type Actor,
  type Transaction,
  type TransactionEventInput,
  type TransactionEventType,
  type TransactionState,
} from "@/lib/payments/transaction";
import { idempotencyKey, memoryIdempotencyStore, once, signWebhook, timingSafeEqualString, verifyWebhookSignature } from "@/lib/payments/webhook";

const BUYER: Actor = { role: "buyer", userId: "buyer-1" };
const TRAVELLER: Actor = { role: "traveller", userId: "traveller-1" };
const PROVIDER: Actor = { role: "provider" };
const SYSTEM: Actor = { role: "system" };
const ADMIN: Actor = { role: "admin" };
const ROLES: Actor[] = [BUYER, TRAVELLER, PROVIDER, SYSTEM, ADMIN];
const DUE = 2_794_500; // ₹27,945.00, the example buyer total
const PAYOUT = 162_000; // ₹1,620.00, the example net reward

const order = (direction: "into_india" | "out_of_india" = "into_india") =>
  createTransaction({ id: "tx-1", direction, buyerId: "buyer-1", travellerId: "traveller-1", pricingSnapshotId: "snap-1", currency: "INR", amountDueMinor: DUE, payoutAmountMinor: PAYOUT });

let seq = 0;
/** A well-formed event: evidence, the right amount and a resolution are filled in so only the rule under test decides. */
function ev(type: TransactionEventType, actor: Actor, tx?: Transaction, extra: Partial<TransactionEventInput> = {}): TransactionEventInput {
  const amount = RULES[type].amount === "payout" ? PAYOUT : RULES[type].amount === "due" ? DUE : undefined;
  return {
    id: `ev-${++seq}`,
    type,
    actor,
    at: "2026-11-11T10:00:00Z",
    evidence: RULES[type].evidence ? ["file-1"] : undefined,
    ...(amount !== undefined ? { amountMinor: amount, currency: tx?.currency ?? "INR" } : {}),
    ...(type === "resolve_dispute" ? { resolution: "pay_traveller" as const } : {}),
    ...extra,
  };
}

/** Applies events in order, failing the test on the first refusal. */
function run(tx: Transaction, steps: [TransactionEventType, Actor, Partial<TransactionEventInput>?][]): Transaction {
  for (const [type, actor, extra] of steps) {
    const r = applyEvent(tx, ev(type, actor, tx, extra));
    if (!r.ok) throw new Error(`${type} by ${actor.role} from ${tx.state}: ${r.error}`);
    tx = r.transaction;
  }
  return tx;
}

const HAPPY: [TransactionEventType, Actor][] = [
  ["request_payment", SYSTEM],
  ["payment_confirmed", PROVIDER],
  ["request_purchase", SYSTEM],
  ["confirm_purchase", TRAVELLER],
  ["start_transit", TRAVELLER],
  ["arrive", TRAVELLER],
  ["record_delivery", TRAVELLER],
  ["request_buyer_confirmation", SYSTEM],
  ["buyer_confirms_delivery", BUYER],
  ["start_payout", ADMIN],
  ["payout_completed", PROVIDER],
];

/** An order placed directly in a state, for exhaustive rule checks. */
const inState = (state: TransactionState, over: Partial<Transaction> = {}): Transaction => ({ ...order(), state, ...over });

describe("order lifecycle: the main path", () => {
  it.each(["into_india", "out_of_india"] as const)("%s: walks every main step in order, recording where each event moved from and to", (direction) => {
    const tx = run(order(direction), HAPPY);
    expect(tx.state).toBe("PAYOUT_COMPLETED");
    expect(tx.direction).toBe(direction);
    expect([tx.history[0].from, ...tx.history.map((e) => e.to)]).toEqual([...MAIN_PATH]);
  });

  it("starts at OFFER_ACCEPTED with the snapshot's amounts and an empty history", () => {
    const tx = order();
    expect(tx).toMatchObject({ state: "OFFER_ACCEPTED", amountDueMinor: DUE, payoutAmountMinor: PAYOUT, chargeback: false, disputeResolution: null, history: [] });
  });

  it("refuses an order that can't be right", () => {
    const base = { id: "t", direction: "into_india" as const, buyerId: "a", travellerId: "b", pricingSnapshotId: "s", currency: "INR" as const, amountDueMinor: 1000, payoutAmountMinor: 500 };
    expect(() => createTransaction({ ...base, travellerId: "a" })).toThrow(/own order/);
    expect(() => createTransaction({ ...base, amountDueMinor: 10.5 })).toThrow();
    expect(() => createTransaction({ ...base, amountDueMinor: 0 })).toThrow();
    expect(() => createTransaction({ ...base, payoutAmountMinor: 1000 })).toThrow(/more than the buyer pays/);
    expect(() => createTransaction({ ...base, pricingSnapshotId: "" })).toThrow();
  });
});

describe("order lifecycle: every state, event and role", () => {
  const types = Object.keys(RULES) as TransactionEventType[];
  // Refusals a listed rule can still give: a guard, or (for a provider outcome) no open attempt to settle.
  const GUARDS = ["blocked_by_dispute", "blocked_by_chargeback", "duplicate_payout", "duplicate_refund", "operation_missing"];

  it("accepts an event only from its listed states and roles; everything else is refused", () => {
    let checked = 0;
    for (const state of ALL_STATES)
      for (const type of types)
        for (const actor of ROLES) {
          const tx = inState(state);
          const r = applyEvent(tx, ev(type, actor, tx));
          const allowed = RULES[type].from.includes(state) && RULES[type].roles.includes(actor.role);
          if (allowed) expect(r.ok || GUARDS.includes(r.error), `${type} by ${actor.role} from ${state}`).toBe(true);
          else expect(r.ok, `${type} by ${actor.role} from ${state}`).toBe(false);
          if (allowed && r.ok) expect(r.transaction.state).toBe(RULES[type].to);
          checked++;
        }
    expect(checked).toBe(ALL_STATES.length * types.length * ROLES.length);
  });

  it("every state can be reached from an accepted offer", () => {
    const seen = new Set<TransactionState>(["OFFER_ACCEPTED"]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const rule of Object.values(RULES)) {
        if (rule.from.some((s) => seen.has(s)) && !seen.has(rule.to)) {
          seen.add(rule.to);
          grew = true;
        }
      }
    }
    expect([...seen].sort()).toEqual([...ALL_STATES].sort());
  });

  it("final states accept nothing but a provider-reported chargeback", () => {
    for (const state of FINAL_STATES) for (const actor of ROLES) expect(availableEvents(inState(state), actor.role).filter((t) => t !== "chargeback")).toEqual([]);
  });

  it("only the provider can report money moving: payment, refund and payout outcomes, chargebacks", () => {
    const providerOnly: TransactionEventType[] = ["payment_confirmed", "payment_failed", "refund_completed", "refund_failed", "payout_completed", "payout_failed", "chargeback"];
    for (const t of providerOnly) expect(RULES[t].roles).toEqual(["provider"]);
    for (const [, rule] of Object.entries(RULES).filter(([, r]) => ["PAYMENT_CONFIRMED", "REFUNDED", "PAYOUT_COMPLETED"].includes(r.to))) expect(rule.roles).toEqual(["provider"]);
  });

  it("a buyer can never confirm a payment, and a traveller can never start or approve their own payout", () => {
    for (const t of ["payment_confirmed", "start_payout", "approve_payout", "payout_completed", "initiate_refund", "refund_completed"] as const) {
      expect(RULES[t].roles).not.toContain("buyer");
      expect(RULES[t].roles).not.toContain("traveller");
    }
    const r = applyEvent(inState("PAYOUT_ELIGIBLE"), ev("start_payout", TRAVELLER));
    expect(r).toMatchObject({ ok: false, error: "role_not_allowed" });
  });

  it("only this order's buyer and traveller can act as buyer or traveller", () => {
    expect(applyEvent(inState("PAYMENT_PENDING"), ev("cancel_payment", { role: "buyer", userId: "someone-else" }))).toMatchObject({ ok: false, error: "not_a_party" });
    expect(applyEvent(inState("IN_TRANSIT"), ev("arrive", { role: "traveller", userId: "buyer-1" }))).toMatchObject({ ok: false, error: "not_a_party" });
    expect(applyEvent(inState("BUYER_CONFIRMATION_PENDING"), ev("buyer_confirms_delivery", { role: "buyer", userId: "traveller-1" }))).toMatchObject({ ok: false, error: "not_a_party" });
  });

  it("refuses unknown events and events without an id", () => {
    expect(applyEvent(order(), { ...ev("request_payment", SYSTEM), type: "release_funds" as TransactionEventType })).toMatchObject({ ok: false, error: "unknown_event" });
    expect(applyEvent(order(), { ...ev("request_payment", SYSTEM), type: "toString" as TransactionEventType })).toMatchObject({ ok: false, error: "unknown_event" });
    expect(applyEvent(order(), { ...ev("request_payment", SYSTEM), id: " " })).toMatchObject({ ok: false, error: "invalid_event" });
  });

  it("skipping ahead is refused: no purchase before payment, no payout before delivery is confirmed", () => {
    expect(applyEvent(order(), ev("payment_confirmed", PROVIDER))).toMatchObject({ ok: false, error: "operation_missing" }); // no payment was ever requested
    expect(applyEvent(inState("PAYMENT_PENDING"), ev("confirm_purchase", TRAVELLER))).toMatchObject({ ok: false, error: "invalid_transition" });
    expect(applyEvent(inState("DELIVERED"), ev("start_payout", ADMIN))).toMatchObject({ ok: false, error: "invalid_transition" });
    expect(applyEvent(inState("BUYER_CONFIRMATION_PENDING"), ev("start_payout", ADMIN))).toMatchObject({ ok: false, error: "invalid_transition" });
  });
});

describe("evidence and amounts", () => {
  it.each(["confirm_purchase", "record_delivery"] as const)("%s needs evidence", (type) => {
    const tx = inState(type === "confirm_purchase" ? "TRAVELLER_PURCHASE_PENDING" : "DELIVERY_PENDING");
    for (const evidence of [undefined, [], ["", "  "]]) expect(applyEvent(tx, ev(type, TRAVELLER, tx, { evidence }))).toMatchObject({ ok: false, error: "evidence_required" });
    expect(applyEvent(tx, ev(type, TRAVELLER, tx, { evidence: ["receipt.jpg"] })).ok).toBe(true);
  });

  it("a payment confirmation must match the snapshot's total exactly, in INR", () => {
    const tx = run(order(), [["request_payment", SYSTEM]]);
    for (const bad of [{ amountMinor: DUE - 1 }, { amountMinor: DUE + 100 }, { currency: "USD" }, { amountMinor: undefined }])
      expect(applyEvent(tx, ev("payment_confirmed", PROVIDER, tx, bad))).toMatchObject({ ok: false, error: "amount_mismatch" });
  });

  it("a payout confirmation must match the traveller's net reward, and a refund the amount paid", () => {
    const paying = run(order(), HAPPY.slice(0, 10));
    const refunding = run(order(), [...HAPPY.slice(0, 2), ["require_manual_review", ADMIN], ["initiate_refund", ADMIN]]);
    expect(applyEvent(paying, ev("payout_completed", PROVIDER, undefined, { amountMinor: DUE }))).toMatchObject({ ok: false, error: "amount_mismatch" });
    expect(applyEvent(refunding, ev("refund_completed", PROVIDER, undefined, { amountMinor: PAYOUT }))).toMatchObject({ ok: false, error: "amount_mismatch" });
  });
});

describe("duplicate events", () => {
  it("a webhook delivered twice changes nothing the second time", () => {
    const tx = run(order(), [["request_payment", SYSTEM]]);
    const event = ev("payment_confirmed", PROVIDER, tx);
    const first = applyEvent(tx, event);
    expect(first.ok && first.transaction.state).toBe("PAYMENT_CONFIRMED");
    const again = first.ok ? applyEvent(first.transaction, event) : first;
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(again.ok && again.transaction).toBe(first.ok && first.transaction);
  });

  it("a redelivered payment confirmation stays a no-op even after the order has moved on", () => {
    const paid = applyEvent(run(order(), [["request_payment", SYSTEM]]), { ...ev("payment_confirmed", PROVIDER), id: "provider-evt-9" });
    const later = run(paid.ok ? paid.transaction : order(), [["request_purchase", SYSTEM]]);
    const replay = applyEvent(later, { ...ev("payment_confirmed", PROVIDER), id: "provider-evt-9" });
    expect(replay).toMatchObject({ ok: true, duplicate: true });
    expect(replay.ok && replay.transaction.state).toBe("TRAVELLER_PURCHASE_PENDING");
    expect(later.history.filter((e) => e.type === "payment_confirmed")).toHaveLength(1);
  });

  it("reusing an event id for a different event is refused", () => {
    const tx = run(order(), [["request_payment", SYSTEM, { id: "same" }]]);
    expect(applyEvent(tx, { ...ev("cancel_payment", BUYER), id: "same" })).toMatchObject({ ok: false, error: "event_id_conflict" });
  });

  it("a second payment attempt can't confirm twice: once confirmed, another confirmation is refused", () => {
    const tx = run(order(), [["request_payment", SYSTEM], ["payment_confirmed", PROVIDER]]);
    expect(applyEvent(tx, ev("payment_confirmed", PROVIDER, tx))).toMatchObject({ ok: false, error: "operation_missing" });
  });

  it("a failed payment can be retried, and the retry is a new pending payment", () => {
    const tx = run(order(), [["request_payment", SYSTEM], ["payment_failed", PROVIDER], ["retry_payment", SYSTEM], ["payment_confirmed", PROVIDER]]);
    expect(tx.state).toBe("PAYMENT_CONFIRMED");
  });
});

describe("provider outcomes are never dropped (P1-1)", () => {
  it("a payment captured after the buyer cancelled is recorded and sent to review, not refused", () => {
    const cancelled = run(order(), [["request_payment", SYSTEM], ["cancel_payment", BUYER]]);
    expect(cancelled.state).toBe("PAYMENT_CANCELLED");
    const r = applyEvent(cancelled, ev("payment_confirmed", PROVIDER, cancelled));
    expect(r.ok && r.transaction.state).toBe("MANUAL_REVIEW_REQUIRED");
    expect(r.ok && r.transaction.history.at(-1)).toMatchObject({ type: "payment_confirmed", from: "PAYMENT_CANCELLED", to: "MANUAL_REVIEW_REQUIRED", unexpected: true });
  });

  it("while that payment attempt is open, no new attempt and no cancellation can start (no double charge)", () => {
    const cancelled = run(order(), [["request_payment", SYSTEM], ["cancel_payment", BUYER]]);
    expect(applyEvent(cancelled, ev("retry_payment", SYSTEM))).toMatchObject({ ok: false, error: "payment_attempt_open" });
    expect(applyEvent(cancelled, ev("cancel_order", BUYER))).toMatchObject({ ok: false, error: "payment_attempt_open" });
    // Once the provider confirms the cancellation, the attempt is closed, the order stays cancelled, and a retry may start.
    const closed = run(cancelled, [["cancel_payment", PROVIDER]]);
    expect(closed.state).toBe("PAYMENT_CANCELLED");
    expect(closed.history.at(-1)).toMatchObject({ unexpected: true, from: "PAYMENT_CANCELLED", to: "PAYMENT_CANCELLED" });
    expect(run(closed, [["retry_payment", SYSTEM]]).state).toBe("PAYMENT_PENDING");
  });

  it("a payout confirmed while the order is in review is recorded, and can't be started again", () => {
    const tx = run(order(), [...HAPPY.slice(0, 10), ["require_manual_review", ADMIN]]);
    const r = applyEvent(tx, ev("payout_completed", PROVIDER, tx));
    expect(r.ok && r.transaction.history.at(-1)).toMatchObject({ type: "payout_completed", unexpected: true, to: "MANUAL_REVIEW_REQUIRED" });
    if (!r.ok) return;
    expect(applyEvent(r.transaction, ev("approve_payout", ADMIN))).toMatchObject({ ok: false, error: "duplicate_payout" });
  });

  it("a provider failure after an attempt started closes it and leaves the order where it is when unexpected", () => {
    const tx = run(order(), [...HAPPY.slice(0, 10), ["require_manual_review", ADMIN]]);
    const r = applyEvent(tx, ev("payout_failed", PROVIDER, tx));
    expect(r.ok && r.transaction.state).toBe("MANUAL_REVIEW_REQUIRED");
    expect(r.ok && r.transaction.history.at(-1)).toMatchObject({ unexpected: true });
    // The failed payout no longer counts as money moving, so a person can choose again.
    expect(r.ok && applyEvent(r.transaction, ev("approve_payout", ADMIN)).ok).toBe(true);
  });

  it("a second confirmation for an attempt that's already settled is refused, so nothing is recorded twice", () => {
    const tx = run(order(), [["request_payment", SYSTEM], ["payment_confirmed", PROVIDER]]);
    expect(applyEvent(tx, ev("payment_confirmed", PROVIDER, tx))).toMatchObject({ ok: false, error: "operation_missing" });
    expect(tx.history.filter((e) => e.type === "payment_confirmed")).toHaveLength(1);
  });

  it("an unexpected success still has to match the amount", () => {
    const cancelled = run(order(), [["request_payment", SYSTEM], ["cancel_payment", BUYER]]);
    expect(applyEvent(cancelled, ev("payment_confirmed", PROVIDER, cancelled, { amountMinor: DUE - 1 }))).toMatchObject({ ok: false, error: "amount_mismatch" });
  });

  it.each(["into_india", "out_of_india"] as const)("%s: the same rules apply in both directions", (direction) => {
    const cancelled = run(order(direction), [["request_payment", SYSTEM], ["cancel_payment", BUYER]]);
    const r = applyEvent(cancelled, ev("payment_confirmed", PROVIDER, cancelled));
    expect(r.ok && r.transaction.state).toBe("MANUAL_REVIEW_REQUIRED");
  });
});

describe("payouts and refunds: never both, never twice", () => {
  const delivered = () => run(order(), HAPPY.slice(0, 9)); // up to PAYOUT_ELIGIBLE

  it("a payout that gets stuck and goes to review can't be started again from there", () => {
    const tx = run(delivered(), [["start_payout", ADMIN], ["require_manual_review", ADMIN]]);
    expect(tx.state).toBe("MANUAL_REVIEW_REQUIRED");
    expect(applyEvent(tx, ev("approve_payout", ADMIN))).toMatchObject({ ok: false, error: "duplicate_payout" });
    expect(applyEvent(tx, ev("initiate_refund", ADMIN))).toMatchObject({ ok: false, error: "duplicate_payout" });
  });

  it("a payout the provider reports as failed can be retried by an admin", () => {
    const tx = run(delivered(), [["start_payout", ADMIN], ["payout_failed", PROVIDER], ["start_payout", ADMIN], ["payout_completed", PROVIDER]]);
    expect(tx.state).toBe("PAYOUT_COMPLETED");
    expect(tx.history.filter((e) => e.type === "start_payout")).toHaveLength(2);
  });

  it("an order being refunded can't be paid out, and a refund can't be started twice", () => {
    const tx = run(delivered(), [["open_dispute", BUYER], ["review_dispute", ADMIN], ["resolve_dispute", ADMIN, { resolution: "refund_buyer" }], ["initiate_refund", ADMIN], ["require_manual_review", ADMIN]]);
    expect(applyEvent(tx, ev("approve_payout", ADMIN))).toMatchObject({ ok: false, error: "duplicate_refund" });
    expect(applyEvent(tx, ev("initiate_refund", ADMIN))).toMatchObject({ ok: false, error: "duplicate_refund" });
  });

  it("after a refund fails, a person can choose again", () => {
    const tx = run(delivered(), [["require_manual_review", ADMIN], ["initiate_refund", ADMIN], ["refund_failed", PROVIDER]]);
    expect(tx.state).toBe("MANUAL_REVIEW_REQUIRED");
    expect(applyEvent(tx, ev("initiate_refund", ADMIN)).ok).toBe(true);
  });

  it("a chargeback, even after a completed payout, goes to review and blocks any further payout or refund", () => {
    const tx = run(order(), [...HAPPY, ["chargeback", PROVIDER]]);
    expect(tx).toMatchObject({ state: "MANUAL_REVIEW_REQUIRED", chargeback: true });
    expect(applyEvent(tx, ev("approve_payout", ADMIN))).toMatchObject({ ok: false });
    expect(applyEvent(tx, ev("initiate_refund", ADMIN))).toMatchObject({ ok: false, error: "blocked_by_chargeback" });
  });
});

describe("disputes and problems", () => {
  const paid = () => run(order(), HAPPY.slice(0, 2));

  it.each(["into_india", "out_of_india"] as const)("%s: a problem reported in transit goes to review and can end in a refund", (direction) => {
    const tx = run(run(order(direction), HAPPY.slice(0, 5)), [
      ["open_dispute", BUYER],
      ["review_dispute", ADMIN],
      ["resolve_dispute", ADMIN, { resolution: "refund_buyer" }],
      ["initiate_refund", ADMIN],
      ["refund_completed", PROVIDER],
    ]);
    expect(tx).toMatchObject({ state: "REFUNDED", disputeResolution: "refund_buyer" });
  });

  it("a dispute resolved for the traveller leads back to payout eligibility, never straight to paid", () => {
    const tx = run(run(order(), HAPPY.slice(0, 7)), [["open_dispute", TRAVELLER], ["review_dispute", ADMIN], ["resolve_dispute", ADMIN, { resolution: "pay_traveller" }], ["approve_payout", ADMIN]]);
    expect(tx.state).toBe("PAYOUT_ELIGIBLE");
  });

  it("the resolution decides which way money can move", () => {
    const toRefund = inState("DISPUTE_RESOLVED", { disputeResolution: "refund_buyer" });
    const toPayout = inState("DISPUTE_RESOLVED", { disputeResolution: "pay_traveller" });
    expect(applyEvent(toRefund, ev("approve_payout", ADMIN))).toMatchObject({ ok: false, error: "blocked_by_dispute" });
    expect(applyEvent(toPayout, ev("initiate_refund", ADMIN))).toMatchObject({ ok: false, error: "blocked_by_dispute" });
    expect(applyEvent(inState("DISPUTE_UNDER_REVIEW"), ev("resolve_dispute", ADMIN, undefined, { resolution: undefined }))).toMatchObject({ ok: false, error: "resolution_required" });
  });

  it("while a dispute is open nothing moves money, and only an admin can move it on", () => {
    const tx = run(paid(), [["open_dispute", BUYER]]);
    for (const actor of ROLES) for (const t of availableEvents(tx, actor.role)) expect(["review_dispute", "require_manual_review", "chargeback"]).toContain(t);
  });

  it("a traveller who can't buy the item, and a buyer who doesn't respond, both go to a person; nothing is automatic", () => {
    expect(run(paid(), [["request_purchase", SYSTEM], ["report_cannot_purchase", TRAVELLER]]).state).toBe("MANUAL_REVIEW_REQUIRED");
    expect(run(run(order(), HAPPY.slice(0, 8)), [["flag_no_buyer_response", SYSTEM]]).state).toBe("MANUAL_REVIEW_REQUIRED");
    expect(RULES.flag_no_buyer_response.to).toBe("MANUAL_REVIEW_REQUIRED");
  });

  it("no dispute can be opened once a payout is under way; that's for the provider's chargeback process", () => {
    expect(applyEvent(inState("PAYOUT_PROCESSING"), ev("open_dispute", BUYER))).toMatchObject({ ok: false, error: "invalid_transition" });
  });

  it("cancelling is only possible before any money is collected", () => {
    expect(run(order(), [["cancel_order", BUYER]]).state).toBe("ORDER_CANCELLED");
    expect(applyEvent(inState("PAYMENT_CONFIRMED"), ev("cancel_order", BUYER))).toMatchObject({ ok: false, error: "invalid_transition" });
  });
});

describe("history is append-only", () => {
  it("applying an event never changes the order it was given", () => {
    const tx = order();
    const before = JSON.stringify(tx);
    run(tx, HAPPY);
    expect(JSON.stringify(tx)).toBe(before);
  });

  it("orders and their history are frozen", () => {
    const tx = run(order(), HAPPY.slice(0, 4));
    expect(Object.isFrozen(tx)).toBe(true);
    expect(Object.isFrozen(tx.history)).toBe(true);
    expect(Object.isFrozen(tx.history[0])).toBe(true);
    expect(() => (tx.history as unknown as TransactionEventInput[]).push(ev("arrive", TRAVELLER))).toThrow();
  });
});

describe("status labels", () => {
  const PROVIDER_CONFIRMED: TransactionState[] = ["PAYMENT_CONFIRMED", "REFUNDED", "PAYOUT_COMPLETED"];

  it("never say paid or refunded before the provider confirms it", () => {
    for (const state of ALL_STATES)
      for (const label of Object.values(STATE_LABEL[state])) {
        if (/\b(paid|refunded)\b/i.test(label)) expect(["REFUNDED", "REFUND_PENDING"], `${state}: ${label}`).toContain(state);
        if (/confirmed by the payment provider/i.test(label)) expect(PROVIDER_CONFIRMED, `${state}: ${label}`).toContain(state);
      }
  });

  it("the traveller's payout labels are separate steps: eligible, processing, confirmed", () => {
    expect(STATE_LABEL.PAYOUT_ELIGIBLE.traveller).toMatch(/not yet sent/);
    expect(STATE_LABEL.PAYOUT_PROCESSING.traveller).toMatch(/processing/);
    expect(STATE_LABEL.PAYOUT_COMPLETED.traveller).toMatch(/confirmed by the payment provider/);
  });
});

describe("payments switch and provider", () => {
  it("payments are off, and the provider is the disabled one", () => {
    expect(PAYMENTS_ENABLED).toBe(false);
    expect(getPaymentProvider()).toBe(disabledProvider);
  });

  it("every provider operation refuses, and none ever reports success", async () => {
    const p = getPaymentProvider();
    const tx = order();
    const results = await Promise.all([
      p.createPayment({ transactionId: "tx-1", amountMinor: DUE, currency: "INR", idempotencyKey: "k" }),
      p.verifyPayment({ providerPaymentId: "pay_1", expectedAmountMinor: DUE, currency: "INR" }),
      p.getPaymentStatus("pay_1"),
      p.initiateRefund({ providerPaymentId: "pay_1", amountMinor: DUE, idempotencyKey: "k" }),
      p.getRefundStatus("rf_1"),
      p.initiatePayout({ transactionId: "tx-1", travellerAccountRef: "acc", amountMinor: PAYOUT, idempotencyKey: "k" }),
      p.getPayoutStatus("po_1"),
      p.verifyWebhook({ rawBody: "{}", headers: {} }),
      p.reconcileTransaction(tx, "pay_1"),
    ]);
    expect(results).toHaveLength(9);
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "payments_disabled" });
  });

  it("the switch can't be turned on from the browser or a setting", () => {
    const flags = readFileSync("src/lib/payments/flags.ts", "utf8");
    expect(flags.startsWith('import "server-only";')).toBe(true);
    expect(flags).toMatch(/export const PAYMENTS_ENABLED: boolean = false;/);
    expect(flags).not.toMatch(/process\.env/);
    for (const f of ["provider.ts", "webhook.ts"]) expect(readFileSync(`src/lib/payments/${f}`, "utf8").startsWith('import "server-only";')).toBe(true);

    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
    const all = files("src");
    expect(all.filter((f) => readFileSync(f, "utf8").includes("PAYMENTS_ENABLED") && !f.endsWith("flags.ts")).filter((f) => !f.includes("payments/"))).toEqual([]);
    expect(all.filter((f) => /NEXT_PUBLIC_PAYMENT/.test(readFileSync(f, "utf8")))).toEqual([]);
    const clientImports = all.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /^["']use client["']/.test(src) && /@\/lib\/payments\/(flags|provider|webhook)/.test(src);
    });
    expect(clientImports).toEqual([]);
  });
});

describe("reconciliation", () => {
  const paid = () => run(order(), HAPPY.slice(0, 2));
  const rec = (over = {}) => ({ orderRef: "tx-1", status: "captured" as const, amountMinor: DUE, currency: "INR", ...over });

  it("agrees when the provider's record matches the order", () => {
    expect(reconcilePayment(paid(), rec())).toEqual([]);
  });

  it("flags every mismatch: amount, currency, order, status", () => {
    expect(reconcilePayment(paid(), rec({ amountMinor: DUE - 100 }))).toHaveLength(1);
    expect(reconcilePayment(paid(), rec({ currency: "USD" }))).toHaveLength(1);
    expect(reconcilePayment(paid(), rec({ orderRef: "tx-2" }))).toHaveLength(1);
    expect(reconcilePayment(paid(), rec({ status: "reversed" }))).toHaveLength(1);
    expect(reconcilePayment(order(), rec())).toEqual(["The provider captured a payment this order never recorded."]);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test_only";
  const body = '{"id":"evt_1","type":"payment.captured"}';
  const ts = "1794400000";
  const now = 1794400000 * 1000;
  const check = (over = {}) => verifyWebhookSignature({ rawBody: body, signature: signWebhook(secret, ts, body), timestamp: ts, secret, nowMs: now, ...over });

  it("accepts a correctly signed, recent message", () => {
    expect(check()).toEqual({ ok: true });
    expect(check({ signature: signWebhook(secret, ts, body).toUpperCase() })).toEqual({ ok: true });
  });

  it("rejects a changed body, a wrong secret or a signature for another timestamp", () => {
    expect(check({ rawBody: body.replace("captured", "refunded") })).toEqual({ ok: false, reason: "bad_signature" });
    expect(check({ signature: signWebhook("other", ts, body) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(check({ signature: signWebhook(secret, String(Number(ts) + 1), body) })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("fails closed when anything is missing or malformed", () => {
    expect(check({ secret: "" })).toEqual({ ok: false, reason: "missing_secret" });
    expect(check({ secret: undefined })).toEqual({ ok: false, reason: "missing_secret" });
    expect(check({ signature: null })).toEqual({ ok: false, reason: "missing_signature" });
    expect(check({ signature: "abc" })).toEqual({ ok: false, reason: "missing_signature" });
    expect(check({ timestamp: "soon" })).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(check({ timestamp: undefined })).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("rejects a replay of an old message, and one from the future", () => {
    expect(check({ nowMs: now + 301_000 })).toEqual({ ok: false, reason: "stale" });
    expect(check({ nowMs: now - 301_000 })).toEqual({ ok: false, reason: "stale" });
    expect(check({ nowMs: now + 299_000 })).toEqual({ ok: true });
  });

  it("compares strings in constant time without treating different lengths as equal", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "abcd")).toBe(false);
    expect(timingSafeEqualString("", "")).toBe(true);
  });
});

describe("idempotency", () => {
  it("runs a handler once per key; a repeat is reported as a duplicate and does nothing", async () => {
    const store = memoryIdempotencyStore();
    let calls = 0;
    const key = idempotencyKey("payout", "tx-1", 1);
    expect(await once(store, key, async () => ++calls)).toEqual({ duplicate: false, value: 1 });
    expect(await once(store, key, async () => ++calls)).toEqual({ duplicate: true });
    expect(calls).toBe(1);
    expect(await once(store, idempotencyKey("payout", "tx-1", 2), async () => ++calls)).toEqual({ duplicate: false, value: 2 });
  });

  it("keys are deterministic per operation and attempt, and reject unsafe input", () => {
    expect(idempotencyKey("payment", "tx-1", 1)).toBe(idempotencyKey("payment", "tx-1", 1));
    expect(idempotencyKey("payment", "tx-1", 1)).not.toBe(idempotencyKey("refund", "tx-1", 1));
    expect(() => idempotencyKey("payment", "tx 1", 1)).toThrow();
    expect(() => idempotencyKey("payment", "tx-1", 0)).toThrow();
    expect(() => idempotencyKey("payment", "tx-1", 1.5)).toThrow();
  });
});

describe("tracking preview page", () => {
  // Code and visible text only: comments may say what the page deliberately doesn't do.
  const page = readFileSync("src/app/tracking/page.tsx", "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

  it("offers no checkout, form or button, and makes no escrow or guarantee claims", () => {
    expect(page).not.toMatch(/<form|<button|checkout|action=/i);
    expect(page).not.toMatch(/escrow|guarantee/i);
    expect(page).toMatch(/PAYMENTS_UNAVAILABLE/);
    expect(page).toMatch(/Illustrative, not a real order/);
  });

  it("reads no data: no database, provider or session", () => {
    expect(page).not.toMatch(/supabase|getPaymentProvider|requireUser|cookies\(/);
  });
});
