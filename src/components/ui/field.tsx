import { useId } from "react";

export const inputClass =
  "w-full rounded-control border border-line-strong bg-white px-4 py-3 text-base text-navy placeholder:text-subtle transition-[border-color,box-shadow] duration-200 hover:border-[#B8C5D9] focus-visible:border-teal focus-visible:ring-4 focus-visible:ring-teal/20 focus-visible:outline-none aria-[invalid=true]:border-[#D64545] disabled:cursor-not-allowed disabled:bg-mist motion-reduce:transition-none";
export const labelClass = "flex flex-col gap-1.5 text-sm font-medium text-ink";
export const errorTextClass = "text-sm text-danger";

type ControlProps = { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string };

/** Label, optional hint and error around one control; wires up ids and aria attributes. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: ControlProps) => React.ReactNode;
}) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={labelClass}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && (
        <span id={`${id}-hint`} className="text-sm font-normal text-muted">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className={errorTextClass}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputClass} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputClass} ${className}`} {...props} />;
}
