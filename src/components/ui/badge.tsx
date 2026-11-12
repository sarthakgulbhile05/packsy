export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-mist text-muted",
  info: "bg-info-soft text-info",
  success: "bg-teal-soft text-teal-ink",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]} ${className}`}>{children}</span>;
}
