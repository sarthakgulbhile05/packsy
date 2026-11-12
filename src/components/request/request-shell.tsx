import { SiteHeader } from "@/components/nav/site-header";
import { Badge, type BadgeTone } from "@/components/ui/badge";

/** Header and background shared by the signed-in request pages. */
export function RequestShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-mist font-sans text-navy">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-6 sm:py-10">{children}</main>
    </div>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = { Published: "success", Draft: "info" };

export function StatusChip({ label }: { label: string }) {
  return <Badge tone={STATUS_TONES[label] ?? "neutral"}>{label}</Badge>;
}
