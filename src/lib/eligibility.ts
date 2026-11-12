import type { BadgeTone } from "@/components/ui/badge";
import type { RequestRow } from "./request-row";

/**
 * What a request's eligibility status means, in plain words. Orbitly review sets it; nobody else can. Until
 * a real review exists every request is "unknown", and we say so rather than implying it's allowed.
 */
export const ELIGIBILITY: Record<RequestRow["eligibility_status"], { label: string; tone: BadgeTone; text: string }> = {
  unknown: {
    label: "Not reviewed",
    tone: "neutral",
    text: "Orbitly hasn’t reviewed this item. Customs, import and airline rules depend on the item and the route: check them before you offer or buy.",
  },
  eligible: { label: "Reviewed", tone: "success", text: "Orbitly reviewed this item for this route. Customs still decide at arrival, and duty may apply." },
  review_required: {
    label: "Needs review",
    tone: "warning",
    text: "This item may have restrictions on this route. Check customs, import and airline rules carefully before offering.",
  },
  restricted: { label: "Restricted", tone: "danger", text: "This item is restricted on this route, so travellers can’t offer on it." },
  prohibited: { label: "Can’t be carried", tone: "danger", text: "This item can’t be carried on this route, so travellers can’t offer on it." },
};
