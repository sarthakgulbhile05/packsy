"use client";

import { useId } from "react";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { errorText, fieldClass } from "./ui";

type Props = {
  legend: string;
  fromLabel: string;
  toLabel: string;
  from: string;
  to: string;
  onChange: (route: { from: string; to: string }) => void;
  error?: string;
  /** Form field names, for forms posted to a server action. */
  names?: { from: string; to: string };
};

/** Two country pickers and a swap button. Works the same for requests (buyers) and trips (travellers). */
export function RoutePicker({ legend, fromLabel, toLabel, from, to, onChange, error, names }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const select = (which: "from" | "to", label: string, value: string) => (
    <label className="block min-w-0 flex-1">
      <span className="mb-1.5 block text-sm font-semibold text-[#101C35]">{label}</span>
      <select
        name={names?.[which]}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => onChange(which === "from" ? { from: e.target.value, to } : { from, to: e.target.value })}
        className={fieldClass}
      >
        <option value="">Choose a country</option>
        {COUNTRY_OPTIONS.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-[#101C35]">{legend}</legend>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {select("from", fromLabel, from)}
        <button
          type="button"
          onClick={() => onChange({ from: to, to: from })}
          aria-label="Swap the two countries"
          className="grid size-11 shrink-0 place-items-center self-center rounded-full border border-[#E3E8F0] text-[#101C35] hover:border-[#0F7A6E] focus-visible:ring-4 focus-visible:ring-[#0F7A6E]/30 focus-visible:outline-none sm:self-end"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 rotate-90 sm:rotate-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 7h13l-4-4M17 17H4l4 4" />
          </svg>
        </button>
        {select("to", toLabel, to)}
      </div>
      {error && (
        <p id={errorId} className={`mt-1.5 ${errorText}`}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
