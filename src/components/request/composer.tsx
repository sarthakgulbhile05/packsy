"use client";

import Image, { type StaticImageData } from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { previewLink } from "@/app/request/actions";
import coffeeGrinder from "../../../public/journeys/coffee-grinder.jpg";
import headphones from "../../../public/journeys/headphones.jpg";
import sneakers from "../../../public/journeys/sneakers.jpg";
import { emptyDraft, saveDraft, type RequestDraft } from "@/lib/request-draft";
import { displayHost, normalizeUrl } from "@/lib/url";
import { PhotoPicker } from "./photo-picker";
import { errorText, fieldClass, primaryButton } from "./ui";

type Mode = "link" | "photo" | "text";
const MODES: { id: Mode; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "link", label: "Paste link", hint: "Share a link to anything you want from abroad.", icon: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /> },
  { id: "photo", label: "Add photo", hint: "Seen it somewhere? A photo or screenshot works too.", icon: <><rect x="3" y="5" width="18" height="15" rx="3" /><circle cx="12" cy="12.5" r="3.5" /></> },
  { id: "text", label: "Describe", hint: "No link or photo? Tell us what you’re looking for.", icon: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /> },
];

const LINK_ICON = MODES[0].icon;
const NOT_RETRIEVED = "We couldn’t automatically retrieve this product’s details. You can add a photo or enter the details manually.";

const EXAMPLES: { image: StaticImageData; text: string }[] = [
  { image: headphones, text: "Wireless headphones, UK model" },
  { image: sneakers, text: "Running sneakers from Japan, UK 9" },
  { image: coffeeGrinder, text: "Hand-crank coffee grinder from Italy" },
];

/** One place to start any request: a link, a photo, or a description. */
export function RequestComposer() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("link");
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const textBox = useRef<HTMLTextAreaElement>(null);

  function choose(next: Mode) {
    setMode(next);
    setError("");
  }

  function onTabKey(e: React.KeyboardEvent, index: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + MODES.length) % MODES.length;
    choose(MODES[next].id);
    tabs.current[next]?.focus();
  }

  function go(draft: RequestDraft) {
    if (!saveDraft(draft)) {
      setError("Your browser blocked saving this draft (private mode?). Please allow site storage and try again.");
      return;
    }
    router.push("/request/new");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "link") {
      const url = normalizeUrl(link);
      if (!url) return setError("That doesn’t look like a product link. Check it, or describe the item instead.");
      setBusy(true);
      try {
        const result = await previewLink(url);
        const draft = { ...emptyDraft("link"), url };
        if (result.ok) {
          const p = result.preview;
          const from = p.siteName ?? displayHost(url);
          const linkNote =
            result.status === "success" ? `We read these details from ${from}. Please check they’re right.` : `We read the product name from ${from} but couldn’t get a photo. Add one below, and check the details.`;
          go({ ...draft, title: p.title ?? "", description: p.description ?? "", image: p.image ?? "", linkNote });
        } else if (result.code === "rate_limited") {
          setError(result.reason);
        } else {
          // the server's first sentence says why (a bot check, a home page, an error code…)
          go({ ...draft, linkNote: `${result.reason.split(/(?<=\.)\s/)[0]} ${NOT_RETRIEVED}` });
        }
      } catch {
        go({ ...emptyDraft("link"), url, linkNote: NOT_RETRIEVED });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === "photo") {
      if (!photo) return setError("Add a photo or screenshot of the item first.");
      return go({ ...emptyDraft("photo"), image: photo });
    }
    const description = text.trim();
    if (description.length < 3) return setError("Describe the item in a few words.");
    const firstLine = description.split(/[\n.]/)[0].slice(0, 80);
    return go({ ...emptyDraft("text"), description, title: firstLine });
  }

  return (
    <div className="rounded-3xl border border-[#E3E8F0] bg-white p-4 text-left shadow-[0_24px_60px_-32px_rgba(16,28,53,0.45)] sm:p-6">
      <div role="tablist" aria-label="How do you want to add the item?" className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-mist p-1">
        {MODES.map((m, i) => (
          <button
            key={m.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`mode-${m.id}`}
            role="tab"
            type="button"
            aria-selected={mode === m.id}
            aria-controls="composer-panel"
            tabIndex={mode === m.id ? 0 : -1}
            onClick={() => choose(m.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`group flex h-11 items-center justify-center gap-1.5 rounded-xl px-1 text-[0.88rem] font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-200 focus-visible:ring-4 focus-visible:ring-teal/40 focus-visible:outline-none motion-reduce:transition-none sm:h-12 sm:text-[0.95rem] ${
              mode === m.id ? "bg-white text-navy shadow-[0_1px_2px_rgba(16,28,53,0.08),0_4px_12px_-4px_rgba(16,28,53,0.18)]" : "text-muted hover:text-navy"
            }`}
          >
            <svg viewBox="0 0 24 24" className={`size-[1.1rem] shrink-0 ${mode === m.id ? "text-teal-ink" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {m.icon}
            </svg>
            {m.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3">
        <div id="composer-panel" role="tabpanel" aria-labelledby={`mode-${mode}`}>
          <p className="mb-3 text-[0.95rem] font-medium text-navy">{MODES.find((m) => m.id === mode)?.hint}</p>
          {mode === "link" && (
            <label className="block">
              <span className="sr-only">Product link</span>
              <span className="relative block">
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-teal-ink" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {LINK_ICON}
                </svg>
                <input
                type="url"
                inputMode="url"
                autoComplete="off"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                enterKeyHint="go"
                placeholder="Paste a link from any online store…"
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "composer-error" : "composer-hint"}
                className={`${fieldClass} h-14 rounded-2xl bg-mist/60 pl-12 focus-visible:bg-white`}
              />
              </span>
              {/* Honest: previews read a page's own title and image; when a site blocks that, the buyer fills in details. */}
              <span id="composer-hint" className="mt-2 block text-sm text-muted">
                Most public product pages work. If we can’t read one, you add the details.
              </span>
            </label>
          )}
          {mode === "photo" && <PhotoPicker value={photo} onChange={setPhoto} label="Add a photo or screenshot" />}
          {mode === "text" && (
            <label className="block">
              <span className="sr-only">Describe the item</span>
              <textarea
                ref={textBox}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 600))}
                rows={4}
                placeholder="What is it? Brand, model, size, colour, condition — anything that helps."
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "composer-error" : undefined}
                className={`${fieldClass} min-h-28 resize-y rounded-2xl bg-mist/60 focus-visible:bg-white`}
              />
              <span className="mt-1 block text-right text-xs text-[#5B6B86]">{text.length}/600</span>
            </label>
          )}
        </div>

        {error && (
          <p id="composer-error" role="alert" className={errorText}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} aria-busy={busy} className={primaryButton}>
          {busy ? (
            <>
              <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />
              Finding your product…
            </>
          ) : (
            <>
              Start my request
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </>
          )}
        </button>
        <p className="text-center text-sm text-muted">Free to create. You review everything before it goes anywhere.</p>
      </form>

      <div className="mt-5 border-t border-[#E3E8F0] pt-4">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Try an example</p>
        <ul className="mt-3 flex flex-col gap-2 sm:flex-row">
          {EXAMPLES.map((ex) => (
            <li key={ex.text} className="sm:flex-1">
              <button
                type="button"
                onClick={() => {
                  setText(ex.text);
                  choose("text");
                  setTimeout(() => textBox.current?.focus(), 0);
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line p-2 pr-3 text-left text-sm leading-snug font-medium text-ink transition-colors hover:border-teal focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none"
              >
                <Image src={ex.image} alt="" sizes="44px" className="size-11 shrink-0 rounded-xl bg-mist object-cover" />
                {ex.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
