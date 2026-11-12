"use client";

import Link from "next/link";
import { ApproxAmount, RateNote } from "@/components/currency/currency";
import { useEffect, useState } from "react";
import { publishRequest, saveRequest } from "@/app/request/actions";
import {
  ATTRIBUTE_LABELS,
  clearDraft,
  CONDITIONS,
  CURRENCIES,
  formatMoney,
  ITEM_KINDS,
  loadDraft,
  saveDraft,
  saveRequestOnDevice,
  validateDraft,
  type DraftErrors,
  type RequestDraft,
} from "@/lib/request-draft";
import { countryName, routeLabel } from "@/lib/countries";
import { ACCOUNT_REQUESTS_OPEN, SIGNUPS_OPEN } from "@/lib/preview";
import { displayHost, normalizeUrl } from "@/lib/url";
import { formatDate, OffersPanel } from "./offers";
import { PhotoPicker } from "./photo-picker";
import { RoutePicker } from "./route-picker";
import { errorText, fieldClass, labelClass, primaryButton, secondaryButton } from "./ui";

type Step = "edit" | "review" | "saved";
const STEPS: { id: Step; label: string }[] = [
  { id: "edit", label: "Details" },
  { id: "review", label: "Review" },
  { id: "saved", label: "Saved" },
];

/** Edit → review → confirm a buyer's request. PROTOTYPE: saved on this device only. */
export function ReviewFlow() {
  const [draft, setDraft] = useState<RequestDraft | null | undefined>(undefined);
  const [step, setStep] = useState<Step>("edit");
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saveError, setSaveError] = useState("");
  // What actually happened on confirm: kept on this device, or saved to the account (and maybe published).
  const [outcome, setOutcome] = useState<{ kind: "device" | "draft" | "published"; expiresAt?: string; photoLeftOnDevice?: boolean }>({ kind: "device" });
  const [busy, setBusy] = useState(false);

  // sessionStorage only exists in the browser, so the draft is read after mounting. This also re-runs when
  // Next re-shows this page from its kept-alive cache, so starting a new request never shows the previous one.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(loadDraft());
    setStep("edit");
    setErrors({});
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [step]);

  if (draft === undefined) return <p className="py-16 text-center text-[#5B6B86]">Loading your request…</p>;
  if (draft === null) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-[#101C35]">No request in progress</h1>
        <p className="mt-2 text-[#5B6B86]">Start with a link, a photo or a description of what you’re looking for.</p>
        <Link href="/#start" className={`${primaryButton} mt-6`}>
          Start a request
        </Link>
      </div>
    );
  }

  // Saved on each edit (not in an effect), so a hidden, kept-alive copy of this page can't overwrite a newer draft.
  const update = (next: RequestDraft) => {
    setDraft(next);
    saveDraft(next);
  };
  const set = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => update({ ...draft, [key]: value });
  const kind = ITEM_KINDS.find((k) => k.id === draft.kind) ?? ITEM_KINDS[ITEM_KINDS.length - 1];

  function toReview() {
    const found = validateDraft(draft!);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      if (draft!.url) update({ ...draft!, url: normalizeUrl(draft!.url) ?? draft!.url });
      setStep("review");
    } else {
      // After React renders the errors, move focus to the first field that needs fixing.
      setTimeout(() => document.querySelector<HTMLElement>("main [aria-invalid=true]")?.focus(), 0);
    }
  }

  function confirm() {
    if (saveRequestOnDevice(draft!)) setStep("saved");
    else setSaveError("Your browser blocked saving (private mode?). Allow site storage and try again.");
  }

  // The server re-checks the account, phone and every field; signed-out or unverified buyers are
  // redirected by the action, and this draft stays in the tab so they can come back to it.
  async function saveToAccount(publish: boolean) {
    setBusy(true);
    setSaveError("");
    try {
      const saved = await saveRequest(draft, draft!.id);
      if (!saved.ok) {
        setSaveError(saved.errors?.form ?? saved.reason);
        if (saved.errors && Object.keys(saved.errors).some((k) => k !== "form")) {
          setErrors(saved.errors);
          setStep("edit");
        }
        return;
      }
      update({ ...draft!, id: saved.id });
      if (!publish) {
        setOutcome({ kind: "draft", photoLeftOnDevice: saved.photoLeftOnDevice });
        setStep("saved");
        return;
      }
      const published = await publishRequest(saved.id);
      if (!published.ok) {
        setSaveError(`Your draft is saved, but it wasn’t published: ${published.reason}`);
        return;
      }
      clearDraft();
      setOutcome({ kind: "published", expiresAt: published.expiresAt, photoLeftOnDevice: saved.photoLeftOnDevice });
      setStep("saved");
    } catch {
      setSaveError("We couldn’t reach Orbitly. Check your connection and try again. Nothing new was published.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Progress">
        {STEPS.map((s, i) => {
          const current = s.id === step;
          const done = STEPS.findIndex((x) => x.id === step) > i;
          return (
            <li key={s.id} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
              <span className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${current ? "bg-[#101C35] text-white" : done ? "bg-[#20C7B5] text-[#101C35]" : "bg-[#E3E8F0] text-[#5B6B86]"}`}>
                {done ? "✓" : i + 1}
              </span>
              <span className={current ? "font-semibold text-[#101C35]" : "text-[#5B6B86]"}>{s.label}</span>
              {/* Connectors are decorative; below 360px they'd push "Saved" off-screen. */}
              {i < STEPS.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-6 bg-[#D6DEEA] max-[359px]:hidden sm:w-10" />}
            </li>
          );
        })}
      </ol>

      {step === "edit" && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            toReview();
          }}
          className="flex flex-col gap-5"
        >
          <header>
            <h1 className="font-[family-name:var(--font-display)] text-[1.75rem] leading-tight font-semibold text-[#101C35] sm:text-3xl">Check the details</h1>
            <p className="mt-1 text-[#5B6B86]">Only the name and city are required. More detail helps travellers find the right item.</p>
          </header>

          {draft.linkNote && (
            <p role="status" className={`rounded-2xl p-4 text-sm ${draft.title ? "bg-[#E7F7F5] text-[#0B5E55]" : "bg-[#FFF4E0] text-[#7A4D00]"}`}>
              {draft.linkNote}
            </p>
          )}

          <Field label="What is it?" error={errors.title}>
            {(p) => <input {...p} value={draft.title} maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Vintage hand-crank coffee grinder" className={fieldClass} />}
          </Field>

          <Field label="Description" hint="Optional">
            {(p) => <textarea {...p} rows={3} maxLength={600} value={draft.description} onChange={(e) => set("description", e.target.value)} className={fieldClass} />}
          </Field>

          <div className={labelClass}>
            <span>
              Photo <span className="font-normal text-[#5B6B86]">· optional</span>
            </span>
            {draft.image && !draft.image.startsWith("data:") ? (
              <div className="flex items-center gap-4 rounded-2xl border border-[#D6DEEA] bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- third-party product image from the link preview */}
                <img src={draft.image} alt="Product image from the link" referrerPolicy="no-referrer" onError={() => set("image", "")} className="size-24 shrink-0 rounded-xl bg-[#F5F7FA] object-contain" />
                <div className="flex flex-col gap-2 text-sm">
                  <span className="text-[#5B6B86]">From {displayHost(draft.url || draft.image)}</span>
                  <button type="button" onClick={() => set("image", "")} className={`${secondaryButton} h-10 px-4 text-sm`}>
                    Use my own photo instead
                  </button>
                </div>
              </div>
            ) : (
              <PhotoPicker value={draft.image} onChange={(v) => set("image", v)} />
            )}
          </div>

          <Field label="Product link" hint="Optional" error={errors.url}>
            {(p) => <input {...p} type="url" inputMode="url" value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" className={fieldClass} />}
          </Field>

          <Field label="Type of item">
            {(p) => (
              <select {...p} value={draft.kind} onChange={(e) => set("kind", e.target.value as RequestDraft["kind"])} className={fieldClass}>
                {ITEM_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            {kind.fields.map((key) => (
              <Field key={key} label={ATTRIBUTE_LABELS[key]} hint="Optional">
                {(p) => (
                  <input
                    {...p}
                    maxLength={80}
                    value={draft.attributes[key] ?? ""}
                    onChange={(e) => set("attributes", { ...draft.attributes, [key]: e.target.value })}
                    className={fieldClass}
                  />
                )}
              </Field>
            ))}
            <Field label="Condition">
              {(p) => (
                <select {...p} value={draft.condition} onChange={(e) => set("condition", e.target.value as RequestDraft["condition"])} className={fieldClass}>
                  {CONDITIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Quantity" error={errors.quantity}>
              {(p) => <input {...p} type="number" inputMode="numeric" min={1} max={10} value={draft.quantity} onChange={(e) => set("quantity", Number(e.target.value))} className={fieldClass} />}
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
            <Field label="Budget" hint="Optional" error={errors.budget}>
              {(p) => <input {...p} type="number" inputMode="decimal" min={0} step="any" value={draft.budget} onChange={(e) => set("budget", e.target.value)} placeholder="Most you’d pay for the item" className={fieldClass} />}
            </Field>
            <Field label="Currency">
              {(p) => (
                <select {...p} value={draft.currency} onChange={(e) => set("currency", e.target.value as RequestDraft["currency"])} className={fieldClass}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <RoutePicker
            legend="Where is it coming from, and where is it going?"
            fromLabel="Buy it in"
            toLabel="Deliver it to"
            from={draft.from}
            to={draft.to}
            onChange={(route) => update({ ...draft, ...route })}
            error={errors.route}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={draft.to && draft.to !== draft.from ? `City in ${countryName(draft.to)}` : "Delivery city"} error={errors.deliverTo}>
              {(p) => <input {...p} value={draft.deliverTo} maxLength={60} autoComplete="address-level2" onChange={(e) => set("deliverTo", e.target.value)} placeholder="e.g. Pune or New York" className={fieldClass} />}
            </Field>
            <Field label="Needed by" hint="Optional" error={errors.neededBy}>
              {(p) => <input {...p} type="date" min={new Date().toISOString().slice(0, 10)} value={draft.neededBy} onChange={(e) => set("neededBy", e.target.value)} className={fieldClass} />}
            </Field>
          </div>

          <Field label="Preferred country or store" hint="Optional">
            {(p) => <input {...p} value={draft.originPreference} maxLength={80} onChange={(e) => set("originPreference", e.target.value)} placeholder="e.g. Japan, or any official store" className={fieldClass} />}
          </Field>

          <Field label="Anything else travellers should know?" hint="Optional">
            {(p) => <textarea {...p} rows={3} maxLength={500} value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. Must include the original box and receipt" className={fieldClass} />}
          </Field>

          <div className="sticky bottom-0 -mx-5 border-t border-[#E3E8F0] bg-white/95 px-5 py-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
            <button type="submit" className={primaryButton}>
              Review request
            </button>
          </div>
        </form>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-5">
          <header>
            <h1 className="font-[family-name:var(--font-display)] text-[1.75rem] leading-tight font-semibold text-[#101C35] sm:text-3xl">Review your request</h1>
            <p className="mt-1 text-[#5B6B86]">This is exactly what travellers will see once requests go live.</p>
          </header>
          <Summary draft={draft} />
          {ACCOUNT_REQUESTS_OPEN ? (
            <p className="rounded-2xl bg-[#E7F7F5] p-4 text-sm text-[#0F5F56]">
              <strong>Save a draft</strong> only you can see, or <strong>publish</strong> to show it to signed-in travellers for 30 days (or until your “needed by” date). You’ll need a verified phone number.
              {draft.image.startsWith("data:") && " Your photo stays on this device: it isn’t saved with the request yet."}
            </p>
          ) : (
            <p className="rounded-2xl bg-[#FFF4E0] p-4 text-sm text-[#7A4D00]">
              <strong>Not sent to travellers yet.</strong> Publishing requests is still being built, so confirming saves this request on this device only.
            </p>
          )}
          {saveError && (
            <p role="alert" className={errorText}>
              {saveError}
            </p>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button type="button" onClick={() => setStep("edit")} disabled={busy} className={`${secondaryButton} h-14 sm:w-40`}>
              Edit
            </button>
            {ACCOUNT_REQUESTS_OPEN ? (
              <>
                <button type="button" onClick={() => saveToAccount(false)} disabled={busy} className={`${secondaryButton} h-14 sm:w-44`}>
                  {busy ? "Saving…" : "Save draft"}
                </button>
                <button type="button" onClick={() => saveToAccount(true)} disabled={busy} aria-busy={busy} className={primaryButton}>
                  {busy ? "Working…" : "Publish request"}
                </button>
              </>
            ) : (
              <button type="button" onClick={confirm} className={primaryButton}>
                Confirm request
              </button>
            )}
          </div>
        </div>
      )}

      {step === "saved" && outcome.kind !== "device" && (
        <div>
          <div role="status" className="rounded-3xl bg-[#101C35] p-6 text-white">
            <p className="text-sm font-semibold text-[#20C7B5]">{outcome.kind === "published" ? "Published" : "Draft saved to your account"}</p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold">
              {outcome.kind === "published" ? "Travellers can now see your request" : "Only you can see this draft"}
            </h1>
            <p className="mt-2 text-white/80">
              {outcome.kind === "published"
                ? `It’s visible to signed-in travellers until ${formatDate(outcome.expiresAt?.slice(0, 10) ?? "")}. Offers will appear in My requests.`
                : "Publish it from My requests when you’re ready."}
              {outcome.photoLeftOnDevice && " Your photo stayed on this device and wasn’t saved with the request."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href={draft.id ? `/requests/${draft.id}` : "/requests"} className="inline-flex h-12 items-center rounded-xl bg-[#20C7B5] px-5 font-semibold text-[#101C35] hover:bg-[#3AD3C3] focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:outline-none">
                View in My requests
              </Link>
              <Link href="/#start" className="inline-flex h-12 items-center rounded-xl border border-white/30 px-5 font-semibold text-white hover:border-white focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:outline-none">
                Start another request
              </Link>
            </div>
          </div>
          <div className="mt-6">
            <Summary draft={draft} />
          </div>
        </div>
      )}

      {step === "saved" && outcome.kind === "device" && (
        <div>
          <div role="status" className="rounded-3xl bg-[#101C35] p-6 text-white">
            <p className="text-sm font-semibold text-[#20C7B5]">Saved on this device</p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold">Your request is ready</h1>
            <p className="mt-2 text-white/80">
              It hasn’t been sent to travellers: publishing opens soon and will need an account with a verified phone number.
              {SIGNUPS_OPEN && " Set that up now so you’re ready."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {SIGNUPS_OPEN && (
                <Link href="/signup" className="inline-flex h-12 items-center rounded-xl bg-[#20C7B5] px-5 font-semibold text-[#101C35] hover:bg-[#3AD3C3] focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:outline-none">
                  Create account
                </Link>
              )}
              <Link href="/#start" className="inline-flex h-12 items-center rounded-xl border border-white/30 px-5 font-semibold text-white hover:border-white focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:outline-none">
                Start another request
              </Link>
            </div>
          </div>
          <div className="mt-6">
            <Summary draft={draft} />
          </div>
          <OffersPanel request={draft} />
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => React.ReactNode }) {
  const id = `f-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className={labelClass}>
      <label htmlFor={id}>
        {label} {hint && <span className="font-normal text-[#5B6B86]">· {hint.toLowerCase()}</span>}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined })}
      {error && (
        <span id={`${id}-error`} className={errorText}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Summary({ draft }: { draft: RequestDraft }) {
  const kind = ITEM_KINDS.find((k) => k.id === draft.kind);
  const rows: [string, string][] = [
    ["Type", kind?.label ?? ""],
    ...kind!.fields.map((k) => [ATTRIBUTE_LABELS[k], draft.attributes[k] ?? ""] as [string, string]),
    ["Condition", draft.condition],
    ["Quantity", String(draft.quantity)],
    ["Budget", draft.budget ? formatMoney(Number(draft.budget), draft.currency) : ""],
    ["Route", draft.from && draft.to ? routeLabel(draft.from, draft.to) : ""],
    ["Deliver to", draft.deliverTo],
    ["Needed by", formatDate(draft.neededBy)],
    ["Preferred country or store", draft.originPreference],
    ["Notes", draft.notes],
  ];
  return (
    <article className="overflow-hidden rounded-3xl border border-[#E3E8F0] bg-white">
      <div className="flex gap-4 p-5">
        {draft.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- local data URL or the store's own product image
          <img src={draft.image} alt="" referrerPolicy="no-referrer" className="size-24 shrink-0 rounded-2xl bg-[#F5F7FA] object-contain sm:size-28" />
        ) : (
          <div aria-hidden="true" className="grid size-24 shrink-0 place-items-center rounded-2xl bg-[#F5F7FA] text-xs text-[#5B6B86] sm:size-28">
            No photo
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold break-words text-[#101C35]">{draft.title}</h2>
          {draft.description && <p className="mt-1 text-sm break-words text-[#5B6B86]">{draft.description}</p>}
          {draft.url && (
            <a href={draft.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-block text-sm font-semibold break-all text-[#0F7A6E] underline">
              {displayHost(draft.url)}
            </a>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-1 border-t border-[#E3E8F0] sm:grid-cols-2">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="border-b border-[#F0F3F8] px-5 py-3">
              <dt className="text-xs text-[#5B6B86]">{k}</dt>
              <dd className="break-words text-[#101C35]">
                {v}
                {k === "Budget" && <ApproxAmount amount={Number(draft.budget)} currency={draft.currency} />}
              </dd>
            </div>
          ))}
      </dl>
        {draft.budget && <RateNote className="px-5 pt-1 pb-4" currency={draft.currency} />}
    </article>
  );
}
