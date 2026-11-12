"use client";

import { useActionState, useState } from "react";
import { sendOffer, type OfferFormState } from "@/app/trips/actions";
import { SubmitButton } from "@/components/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputClass } from "@/components/ui/field";
import { HANDOFF_METHODS } from "@/lib/offer";
import { rupees } from "@/lib/pricing";
import { CURRENCIES } from "@/lib/request-draft";
import { TravellerPayout } from "./price-breakdown";

/** A traveller's offer on one matching request. Amounts are whole rupees, as offers are stored today. */
export function OfferForm({ requestId, tripId }: { requestId: string; tripId: string }) {
  const [state, action] = useActionState<OfferFormState, FormData>(sendOffer, {});
  const [currency, setCurrency] = useState<string>("USD");
  const [reward, setReward] = useState("");
  const wholeReward = /^\d+$/.test(reward) ? Number(reward) : null;
  const e = state.errors ?? {};

  if (state.sent) return <Alert tone="success" title="Offer sent">The buyer can now accept or decline it. You can withdraw it while it’s pending.</Alert>;

  return (
    <form action={action} className="mt-4 space-y-4 border-t border-line pt-4">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="tripId" value={tripId} />
      {(state.message || e.form) && <Alert tone="error">{state.message ?? e.form}</Alert>}
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field label="Product price" error={e.productPrice}>
          {(p) => <input {...p} name="productPrice" type="number" inputMode="decimal" min={0.01} step="0.01" required className={inputClass} />}
        </Field>
        <Field label="Currency">
          {(p) => (
            <select {...p} name="currency" value={currency} onChange={(ev) => setCurrency(ev.target.value)} className={inputClass}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {currency !== "INR" && (
        <Field label={`Your rate: rupees per 1 ${currency}`} hint="Your own assumption. Orbitly doesn’t set exchange rates." error={e.rate}>
          {(p) => <input {...p} name="rate" type="number" inputMode="decimal" min={0.000001} step="any" required className={inputClass} />}
        </Field>
      )}
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="fixed" className="mt-1 size-4" />
        I’ll commit to the rupee price (otherwise it’s an estimate that may change)
      </label>
      <Field
        label="Your reward (₹, before Orbitly’s fee)"
        hint="Whole rupees, shown to the buyer separately from the product. Orbitly keeps 10%, and you receive 90%."
        error={e.serviceFee}
      >
        {(p) => (
          <input {...p} name="serviceFee" type="number" inputMode="numeric" min={1} max={1_000_000} step={1} required value={reward} onChange={(ev) => setReward(ev.target.value)} className={inputClass} />
        )}
      </Field>
      {/* The server re-checks the reward; this preview only mirrors the engine's 10% fee. */}
      {wholeReward !== null && wholeReward > 0 && <TravellerPayout grossReward={rupees(wholeReward)} />}
      <Field label="Hand-over" error={e.handoff}>
        {(p) => (
          <select {...p} name="handoff" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choose one
            </option>
            {HANDOFF_METHODS.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="lawful" required className="mt-1 size-4" />
        I’ll only carry this if it’s lawful on this route, and I’ll declare it at customs and pay any duty due.
      </label>
      {e.lawful && <p className="text-sm text-danger">{e.lawful}</p>}
      <SubmitButton variant="brand" pendingText="Sending offer…">
        Send offer
      </SubmitButton>
    </form>
  );
}
