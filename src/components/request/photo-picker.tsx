"use client";

import { useId, useRef, useState } from "react";
import { imageFileProblem, shrinkImage } from "@/lib/image-file";
import { secondaryButton } from "./ui";

/**
 * Pick a photo or screenshot, check it, shrink it on the device and preview it.
 * Nothing is uploaded: the image stays in the buyer's browser for now.
 */
export function PhotoPicker({ value, onChange, label = "Product photo" }: { value: string; onChange: (dataUrl: string) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [state, setState] = useState<"idle" | "processing" | "error">("idle");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    const problem = imageFileProblem(file);
    if (problem) {
      setState("error");
      setError(problem);
      return;
    }
    setState("processing");
    try {
      onChange(await shrinkImage(file));
      setState("idle");
    } catch {
      setState("error");
      setError("We couldn’t read that image. Please try another photo.");
    } finally {
      if (input.current) input.current.value = ""; // allow choosing the same file again
    }
  }

  const fileInput = (
    <input
      ref={input}
      id={id}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      className="sr-only"
      onChange={(e) => handle(e.target.files?.[0])}
    />
  );

  if (value) {
    return (
      <div className="flex items-center gap-4 rounded-2xl border border-[#D6DEEA] bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview, nothing to optimise */}
        <img src={value} alt="Chosen product photo" className="size-24 shrink-0 rounded-xl bg-[#F5F7FA] object-contain" />
        <div className="flex flex-1 flex-wrap gap-2">
          {fileInput}
          <label htmlFor={id} className={`${secondaryButton} h-10 cursor-pointer px-4 text-sm`}>
            Replace
          </label>
          <button type="button" onClick={() => onChange("")} className={`${secondaryButton} h-10 px-4 text-sm text-[#B42318]`}>
            Remove
          </button>
          <p className="w-full text-xs text-[#5B6B86]">Stays on this device for now.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {fileInput}
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files?.[0]);
        }}
        aria-busy={state === "processing"}
        className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragging ? "border-teal bg-teal-soft" : "border-line-strong bg-mist/60 hover:border-teal hover:bg-white"
        }`}
      >
        {state === "processing" ? (
          <>
            <span aria-hidden="true" className="size-6 animate-spin rounded-full border-2 border-[#20C7B5]/30 border-t-[#20C7B5] motion-reduce:animate-none" />
            <span className="text-sm font-medium text-[#33415C]">Preparing photo…</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="size-8 text-teal-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="15" rx="3" />
              <circle cx="12" cy="12.5" r="3.5" />
              <path d="M8.5 5 10 3h4l1.5 2" />
            </svg>
            <span className="font-semibold text-[#101C35]">{label}</span>
            <span className="text-sm text-muted">Choose or drop a file · JPG, PNG, WebP up to 10 MB · stays on this device</span>
          </>
        )}
      </label>
      {state === "error" && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-[#B42318]">
          {error}
          <button type="button" onClick={() => input.current?.click()} className="font-semibold underline">
            Try another photo
          </button>
        </p>
      )}
    </div>
  );
}
