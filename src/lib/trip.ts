// A traveller's trip: validation shared by the form (for messages) and the server (the trust boundary).
// Input is rebuilt from known keys only; owner, status and verification are never taken from the browser.
import { isCountryCode } from "./countries";

export type TripInput = { from: string; to: string; departureDate: string; arrivalDate: string; capacityKg: string; notes: string };
export type TripErrors = Partial<Record<"route" | "departureDate" | "arrivalDate" | "capacityKg" | "notes" | "form", string>>;

/** Columns a traveller may write (matches the stage 4 insert grant). */
export type TripInsert = {
  departure_country: string;
  destination_country: string;
  departure_date: string;
  arrival_date: string;
  capacity_kg: number | null;
  notes: string | null;
};

export type TripRow = TripInsert & {
  id: string;
  status: "active" | "cancelled" | "completed";
  verification_status: "unverified" | "verified";
  created_at: string;
};

export const TRIP_COLUMNS = "id, departure_country, destination_country, departure_date, arrival_date, capacity_kg, notes, status, verification_status, created_at";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function validateTrip(t: TripInput, today = new Date().toISOString().slice(0, 10)): TripErrors {
  const e: TripErrors = {};
  if (!isCountryCode(t.from) || !isCountryCode(t.to)) e.route = "Choose where you’re flying from and to.";
  else if (t.from === t.to) e.route = "Choose two different countries.";
  if (!DATE.test(t.departureDate)) e.departureDate = "Choose your departure date.";
  else if (t.departureDate < today) e.departureDate = "Choose today or a later date.";
  else if (t.departureDate > addDays(today, 365)) e.departureDate = "Choose a date within the next year.";
  if (!DATE.test(t.arrivalDate)) e.arrivalDate = "Choose your arrival date.";
  else if (!e.departureDate && t.arrivalDate < t.departureDate) e.arrivalDate = "Arrival can’t be before departure.";
  else if (!e.departureDate && t.arrivalDate > addDays(t.departureDate, 30)) e.arrivalDate = "Arrival must be within 30 days of departure.";
  if (t.capacityKg && !(/^\d{1,3}(\.\d)?$/.test(t.capacityKg) && Number(t.capacityKg) > 0 && Number(t.capacityKg) <= 100)) {
    e.capacityKg = "Enter a weight from 0.1 to 100 kg, or leave it empty.";
  }
  if (t.notes.length > 500) e.notes = "Keep notes under 500 characters.";
  return e;
}

export function readTrip(form: FormData): TripInput {
  return {
    from: str(form.get("from")),
    to: str(form.get("to")),
    departureDate: str(form.get("departureDate")),
    arrivalDate: str(form.get("arrivalDate")),
    capacityKg: str(form.get("capacityKg")),
    notes: str(form.get("notes")),
  };
}

export function tripToRow(t: TripInput, today?: string): { ok: true; row: TripInsert } | { ok: false; errors: TripErrors } {
  const errors = validateTrip(t, today);
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    row: {
      departure_country: t.from,
      destination_country: t.to,
      departure_date: t.departureDate,
      arrival_date: t.arrivalDate,
      capacity_kg: t.capacityKg ? Number(t.capacityKg) : null,
      notes: t.notes || null,
    },
  };
}

/** What the traveller sees for a stored trip. A trip whose arrival has passed is shown as finished. */
export function tripStatus(row: Pick<TripRow, "status" | "arrival_date">, today = new Date().toISOString().slice(0, 10)) {
  if (row.status === "cancelled") return { label: "Cancelled", live: false };
  if (row.status === "completed" || row.arrival_date < today) return { label: "Finished", live: false };
  return { label: "Active", live: true };
}
