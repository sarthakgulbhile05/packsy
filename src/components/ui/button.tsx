import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "accent";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-navy text-white shadow-[0_12px_28px_-14px_rgba(16,28,53,0.9)] hover:bg-navy-hover",
  secondary: "border border-line-strong bg-white text-navy hover:border-navy",
  ghost: "text-muted hover:bg-mist hover:text-navy",
  accent: "bg-teal text-navy hover:bg-teal-hover", // on navy surfaces
};
const SIZES: Record<Size, string> = {
  sm: "h-10 rounded-control px-4 text-sm",
  md: "h-12 rounded-control px-5 text-base",
  lg: "h-14 rounded-2xl px-6 text-lg",
};

/** Classes for anything that should look like a button, including links. */
export function buttonClass({ variant = "primary", size = "md", full = false }: { variant?: Variant; size?: Size; full?: boolean } = {}) {
  return `inline-flex items-center justify-center gap-2 font-semibold transition-[background-color,border-color,color] duration-200 active:translate-y-px focus-visible:ring-4 focus-visible:ring-teal/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""}`;
}

export function Button({
  variant,
  size,
  full,
  loading = false,
  loadingText,
  className = "",
  children,
  disabled,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  /** Disables the button and shows a spinner (and `loadingText`, if given). */
  loading?: boolean;
  loadingText?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonClass({ variant, size, full })} ${className}`}
      {...props}
    >
      {loading && <Spinner className={variant === "primary" || variant === undefined ? "text-white" : "text-navy"} />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
