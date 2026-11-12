import { describe, expect, it } from "vitest";
import { emptyDraft } from "@/lib/request-draft";
import { draftToRow, isRequestId, requestStatus, rowToDraft, type RequestRow } from "@/lib/request-row";

const TODAY = "2026-10-29";
const base = { ...emptyDraft("text"), title: "Vintage coffee grinder", from: "US", to: "IN", deliverTo: "Pune" };
const row = (input: unknown) => {
  const r = draftToRow(input, TODAY);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const errors = (input: unknown) => {
  const r = draftToRow(input, TODAY);
  if (r.ok) throw new Error("expected errors");
  return r.errors;
};

describe("draftToRow: the three entry paths", () => {
  it("describe: only the name, route and city are needed", () => {
    expect(row(base).row).toEqual({
      title: "Vintage coffee grinder", description: null, product_url: null, item_kind: "other", attributes: {},
      item_condition: "new", quantity: 1, budget_amount: null, budget_currency: null, origin_preference: null,
      source_country: "US", destination_country: "IN", delivery_city: "Pune", needed_by: null, notes: null, preview_image_url: null,
    });
  });

  it("link: keeps the cleaned https link and the store's own public image", () => {
    const r = row({ ...base, source: "link", url: "shop.example/p/1?utm_source=x", image: "https://img.shop.example/a.jpg" });
    expect(r.row).toMatchObject({ product_url: "https://shop.example/p/1", preview_image_url: "https://img.shop.example/a.jpg" });
    expect(r.photoLeftOnDevice).toBe(false);
  });

  it("photo: a photo from this device is never sent to the database, and the buyer is told", () => {
    const r = row({ ...base, source: "photo", image: "data:image/jpeg;base64,AAAA" });
    expect(r.row.preview_image_url).toBeNull();
    expect(r.photoLeftOnDevice).toBe(true);
  });
});

describe("draftToRow: nothing the browser claims about ownership or status is copied", () => {
  it("ignores owner, status, dates, ids and deprecated fields", () => {
    const r = row({ ...base, shopper_id: "someone-else", eligibility_status: "eligible", status: "open", published_at: "2026-01-01", expires_at: "2099-01-01", id: "x", price_inr: 1, reward_inr: 1, image_path: "a/b" });
    expect(Object.keys(r.row).sort()).toEqual(["attributes", "budget_amount", "budget_currency", "delivery_city", "description", "destination_country", "item_condition", "item_kind",
      "needed_by", "notes", "origin_preference", "preview_image_url", "product_url", "quantity", "source_country", "title"]);
  });

  it("keeps only the attributes that belong to the item type, trimmed to 80 characters", () => {
    const r = row({ ...base, kind: "electronics", attributes: { brand: ` ${"B".repeat(90)} `, model: "X1", size: "XL", evil: "<script>" } });
    expect(r.row.attributes).toEqual({ brand: "B".repeat(80), model: "X1" });
  });

  it("maps condition labels and budgets to database values", () => {
    expect(row({ ...base, condition: "Used – good condition", budget: "24999.50", currency: "USD" }).row).toMatchObject({
      item_condition: "used_good", budget_amount: 24999.5, budget_currency: "USD",
    });
  });
});

describe("draftToRow: invalid input is refused before any database call", () => {
  it.each([
    ["not an object", null, "form"],
    ["a string", "hello", "form"],
    ["title too short", { ...base, title: "ab" }, "title"],
    ["no city", { ...base, deliverTo: "" }, "deliverTo"],
    ["city over 100", { ...base, deliverTo: "P".repeat(101) }, "deliverTo"],
    ["quantity 0", { ...base, quantity: 0 }, "quantity"],
    ["quantity as text", { ...base, quantity: "2" }, "quantity"],
    ["budget of 10 crore", { ...base, budget: "100000000" }, "budget"],
    ["budget with 3 decimals", { ...base, budget: "10.555" }, "budget"],
    ["budget in exponent form", { ...base, budget: "1e5" }, "budget"],
    ["http link", { ...base, url: "http://shop.example/p" }, "url"],
    ["javascript link", { ...base, url: "javascript:alert(1)" }, "url"],
    ["needed-by in the past", { ...base, neededBy: "2026-10-01" }, "neededBy"],
    ["needed-by over a year away", { ...base, neededBy: "2027-11-01" }, "neededBy"],
    ["needed-by not a date", { ...base, neededBy: "soon" }, "neededBy"],
    ["unknown item type", { ...base, kind: "weapons" }, "form"],
    ["unknown condition", { ...base, condition: "broken" }, "form"],
    ["unknown currency", { ...base, currency: "BTC" }, "form"],
    ["description over 2000", { ...base, description: "a".repeat(2001) }, "form"],
    ["notes over 1000", { ...base, notes: "a".repeat(1001) }, "form"],
  ])("%s", (_name, input, field) => {
    expect(errors(input)).toHaveProperty(field);
  });
});

describe("draftToRow: third-party preview images", () => {
  it.each([
    ["http", "http://img.shop.example/a.jpg"],
    ["a private IP", "https://192.168.1.10/a.jpg"],
    ["loopback", "https://127.0.0.1/a.jpg"],
    ["localhost", "https://localhost/a.jpg"],
    ["an internal name", "https://images.corp/a.jpg"],
    ["credentials", "https://user:pw@img.shop.example/a.jpg"],
    ["an odd port", "https://img.shop.example:8443/a.jpg"],
    ["javascript", "javascript:alert(1)"],
    ["whitespace", "https://img.shop.example/a b.jpg"],
  ])("drops %s", (_name, image) => {
    expect(row({ ...base, source: "link", url: "https://shop.example/p", image }).row.preview_image_url).toBeNull();
  });

  it("only keeps an image that came from a link", () => {
    expect(row({ ...base, source: "text", image: "https://img.shop.example/a.jpg" }).row.preview_image_url).toBeNull();
  });
});

describe("rowToDraft and requestStatus", () => {
  const stored: RequestRow = {
    id: "3f1c2b8a-1d2e-4f5a-9b6c-7d8e9f0a1b2c", status: "draft", eligibility_status: "unknown", published_at: null, expires_at: null, created_at: "2026-10-29T10:00:00Z",
    ...row({ ...base, kind: "fashion", attributes: { size: "UK 9" }, condition: "Any condition", budget: "120", currency: "EUR", neededBy: "2026-11-20", notes: "Box please" }).row,
  };

  it("round-trips a stored request through the review screens unchanged", () => {
    const draft = rowToDraft(stored);
    expect(draft).toMatchObject({ id: stored.id, kind: "fashion", condition: "Any condition", budget: "120", currency: "EUR", neededBy: "2026-11-20" });
    expect(row(draft).row).toEqual(row({ ...base, kind: "fashion", attributes: { size: "UK 9" }, condition: "Any condition", budget: "120", currency: "EUR", neededBy: "2026-11-20", notes: "Box please" }).row);
  });

  it("describes each status from stored data, counting expiry from now", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(requestStatus({ status: "draft", expires_at: null }, now).label).toBe("Draft");
    expect(requestStatus({ status: "open", expires_at: "2026-11-28T18:30:00Z" }, now)).toEqual({ label: "Published", detail: "Visible to signed-in travellers until 28 Nov 2026." });
    expect(requestStatus({ status: "open", expires_at: "2026-10-31T00:00:00Z" }, now).label).toBe("Expired");
    expect(requestStatus({ status: "matched", expires_at: null }, now).label).toBe("Offer accepted");
  });

  it("isRequestId accepts only UUIDs", () => {
    expect(isRequestId(stored.id)).toBe(true);
    for (const bad of ["", "1", "../etc", `${stored.id} `, null, 5]) expect(isRequestId(bad)).toBe(false);
  });
});
