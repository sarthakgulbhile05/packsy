export type AlertTone = "success" | "info" | "warning" | "error";

const TONES: Record<AlertTone, string> = {
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  error: "bg-danger-soft text-danger",
};

/** A message box. Errors interrupt screen readers (role="alert"); everything else is announced politely. */
export function Alert({ tone, title, children, className = "" }: { tone: AlertTone; title?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-control p-4 text-sm leading-relaxed ${TONES[tone]} ${className}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
    </div>
  );
}
