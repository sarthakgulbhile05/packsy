// Server-only: the single trust boundary between the request form and the `requests` table.
// Input is rebuilt from known keys only; nothing the browser sends (owner, status, dates) is copied.
import { safeImageUrl } from "./link-preview";
import { CONDITIONS, CURRENCIES, emptyDraft, ITEM_KINDS, validateDraft, type DraftErrors, type RequestDraft } from "./request-draft";
import { normalizeUrl } from "./url";

const CONDITION_CODES: Record<(typeof CONDITIONS)[number], "new" | "used_good" | "any"> = {
  New: "new",
  "Used – good condition": "used_good",
  "Any condition": "any",
};

/** Columns a buyer may write (matches the stage 3a insert/update grants). */
export type RequestInsert = {
  title: string;
  description: string | null;
  product_url: string | null;
  item_kind: string;
  attributes: Record<string, string>;
  item_condition: string;
  quantity: number;
  budget_amount: number | null;
  budget_currency: string | null;
  origin_preference: string | null;
  source_country: string;
  destination_country: string;
  delivery_city: string;
  needed_by: string | null;
  notes: string | null;
  preview_image_url: string | null;
};

export type RequestRow = RequestInsert & {
  id: string;
  status: "draft" | "open" | "matched" | "completed" | "cancelled" | "expired";
  /** Set by Orbitly review only; never by the buyer. */
  eligibility_status: "unknown" | "eligible" | "review_required" | "restricted" | "prohibited";
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export const REQUEST_COLUMNS =
  "id, status, title, description, product_url, item_kind, attributes, item_condition, quantity, budget_amount, budget_currency, origin_preference, source_country, destination_country, eligibility_status, delivery_city, needed_by, notes, preview_image_url, published_at, expires_at, created_at";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRequestId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const orNull = (s: string) => (s ? s : null);


export type DraftToRow =
  | { ok: true; row: RequestInsert; photoLeftOnDevice: boolean }
  | { ok: false; errors: DraftErrors };

export function draftToRow(input: unknown, today = new Date().toISOString().slice(0, 10)): DraftToRow {
  if (!input || typeof input !== "object") return { ok: false, errors: { form: "Something went wrong with this request. Please start again." } };
  const raw = input as Record<string, unknown>;

  const kind = ITEM_KINDS.find((k) => k.id === raw.kind);
  const condition = CONDITIONS.find((c) => c === raw.condition);
  const currency = CURRENCIES.find((c) => c === raw.currency);
  const rawAttributes = raw.attributes && typeof raw.attributes === "object" ? (raw.attributes as Record<string, unknown>) : {};
  const attributes: Record<string, string> = {};
  for (const field of kind?.fields ?? []) {
    const value = str(rawAttributes[field]).slice(0, 80);
    if (value) attributes[field] = value;
  }

  const draft: RequestDraft = {
    ...emptyDraft(raw.source === "link" || raw.source === "photo" ? raw.source : "text"),
    title: str(raw.title),
    description: str(raw.description),
    url: str(raw.url),
    image: str(raw.image),
    kind: kind?.id ?? "other",
    attributes,
    condition: condition ?? "New",
    quantity: typeof raw.quantity === "number" ? raw.quantity : Number.NaN,
    originPreference: str(raw.originPreference),
    budget: str(raw.budget),
    currency: currency ?? "INR",
    neededBy: str(raw.neededBy),
    from: str(raw.from),
    to: str(raw.to),
    deliverTo: str(raw.deliverTo),
    notes: str(raw.notes),
  };

  const errors = validateDraft(draft, today);
  if (!kind || !condition || !currency) errors.form = "Something went wrong with this request. Please start again.";
  if (draft.description.length > 2000 || draft.notes.length > 1000 || draft.originPreference.length > 120) {
    errors.form = "Some details are too long. Please shorten them.";
  }
  if (draft.deliverTo.length > 100) errors.deliverTo = "Keep the city under 100 characters.";
  if (draft.neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(draft.neededBy)) errors.neededBy = "Choose a valid date.";
  const yearAhead = new Date(`${today}T00:00:00Z`);
  yearAhead.setUTCFullYear(yearAhead.getUTCFullYear() + 1);
  if (!errors.neededBy && draft.neededBy && draft.neededBy > yearAhead.toISOString().slice(0, 10)) {
    errors.neededBy = "Choose a date within the next year.";
  }
  const budget = draft.budget ? Number(draft.budget) : null;
  if (!errors.budget && budget !== null && (budget >= 1e8 || !/^\d+(\.\d{1,2})?$/.test(draft.budget))) {
    errors.budget = "Enter a budget under 10 crore, with at most 2 decimals.";
  }
  const url = draft.url ? normalizeUrl(draft.url) : null;
  if (!errors.url && url && !url.startsWith("https://")) errors.url = "Orbitly saves secure links only. Try the https:// version of this link.";
  if (Object.keys(errors).length) return { ok: false, errors };

  // A photo picked on this device (a data: URL) has no storage yet; only a link's own image is kept.
  const photoLeftOnDevice = draft.image.startsWith("data:");
  const image = draft.source === "link" && !photoLeftOnDevice && draft.image ? safeImageUrl(draft.image) : null;

  return {
    ok: true,
    photoLeftOnDevice,
    row: {
      title: draft.title,
      description: orNull(draft.description),
      product_url: url,
      item_kind: draft.kind,
      attributes,
      item_condition: CONDITION_CODES[draft.condition],
      quantity: draft.quantity,
      budget_amount: budget,
      budget_currency: budget === null ? null : draft.currency,
      origin_preference: orNull(draft.originPreference),
      source_country: draft.from,
      destination_country: draft.to,
      delivery_city: draft.deliverTo,
      needed_by: orNull(draft.neededBy),
      notes: orNull(draft.notes),
      preview_image_url: image,
    },
  };
}

/** A stored request in the form the existing review screens already display. */
export function rowToDraft(row: RequestRow): RequestDraft {
  const condition = (Object.keys(CONDITION_CODES) as (typeof CONDITIONS)[number][]).find((c) => CONDITION_CODES[c] === row.item_condition);
  return {
    ...emptyDraft(row.product_url ? "link" : "text"),
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    url: row.product_url ?? "",
    image: row.preview_image_url ?? "",
    kind: ITEM_KINDS.find((k) => k.id === row.item_kind)?.id ?? "other",
    attributes: row.attributes ?? {},
    condition: condition ?? "Any condition",
    quantity: row.quantity,
    originPreference: row.origin_preference ?? "",
    budget: row.budget_amount === null ? "" : String(row.budget_amount),
    currency: CURRENCIES.find((c) => c === row.budget_currency) ?? "INR",
    neededBy: row.needed_by ?? "",
    // Requests saved before routes existed have none: the buyer picks one before publishing.
    from: row.source_country ?? "",
    to: row.destination_country ?? "",
    deliverTo: row.delivery_city,
    notes: row.notes ?? "",
  };
}

/** What the buyer should see for a stored status. Expiry counts from `now`, before any job runs. */
export function requestStatus(row: Pick<RequestRow, "status" | "expires_at">, now = new Date()) {
  if (row.status === "draft") return { label: "Draft", detail: "Only you can see this request." };
  if (row.status === "open") {
    return row.expires_at && new Date(row.expires_at) > now
      ? { label: "Published", detail: `Visible to signed-in travellers until ${new Date(row.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.` }
      : { label: "Expired", detail: "No longer visible to travellers." };
  }
  const labels = { matched: "Offer accepted", completed: "Completed", cancelled: "Cancelled", expired: "Expired" } as const;
  return { label: labels[row.status], detail: "" };
}
