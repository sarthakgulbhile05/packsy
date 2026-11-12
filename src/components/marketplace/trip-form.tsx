"use client";

import { useActionState, useState } from "react";
import { createTrip, type TripFormState } from "@/app/trips/actions";
import { RoutePicker } from "@/components/request/route-picker";
import { SubmitButton } from "@/components/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputClass } from "@/components/ui/field";

const today = () => new Date().toISOString().slice(0, 10);

/** Publish a trip. The server validates everything again; the database checks owner, phone and dates. */
export function TripForm() {
  const [state, action] = useActionState<TripFormState, FormData>(createTrip, {});
  const v = state.values;
  const [route, setRoute] = useState({ from: v?.from ?? "", to: v?.to ?? "" });
  const [departure, setDeparture] = useState(v?.departureDate ?? "");
  const e = state.errors ?? {};

  return (
    <form action={action} className="space-y-5 rounded-card border border-line bg-white p-5 sm:p-6">
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <RoutePicker
        legend="Your route"
        fromLabel="Flying from"
        toLabel="Flying to"
        from={route.from}
        to={route.to}
        onChange={setRoute}
        error={e.route}
        names={{ from: "from", to: "to" }}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Departure date" error={e.departureDate}>
          {(p) => <input {...p} name="departureDate" type="date" required min={today()} defaultValue={v?.departureDate} onChange={(ev) => setDeparture(ev.target.value)} className={inputClass} />}
        </Field>
        <Field label="Arrival date" error={e.arrivalDate}>
          {(p) => <input {...p} name="arrivalDate" type="date" required min={departure || today()} defaultValue={v?.arrivalDate} className={inputClass} />}
        </Field>
      </div>
      <Field label="Space you can spare" hint="Optional, in kg. A rough guide for buyers." error={e.capacityKg}>
        {(p) => <input {...p} name="capacityKg" type="number" inputMode="decimal" min={0.1} max={100} step={0.1} defaultValue={v?.capacityKg} className={inputClass} />}
      </Field>
      <Field label="Notes for yourself" hint="Optional. Only you see these." error={e.notes}>
        {(p) => <textarea {...p} name="notes" rows={2} maxLength={500} defaultValue={v?.notes} className={inputClass} />}
      </Field>
      <SubmitButton variant="brand" pendingText="Publishing your trip…">
        Publish trip
      </SubmitButton>
    </form>
  );
}
