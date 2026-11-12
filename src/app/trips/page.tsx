import Link from "next/link";
import { Suspense } from "react";
import { TripForm } from "@/components/marketplace/trip-form";
import { RequestShell } from "@/components/request/request-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { routeLabel } from "@/lib/countries";
import { MARKETPLACE_OPEN } from "@/lib/preview";
import { NOINDEX } from "@/lib/site";
import { TRIP_COLUMNS, tripStatus, type TripRow } from "@/lib/trip";
import { formatDate } from "@/components/request/offers";

export const metadata = { title: "My trips", robots: NOINDEX };

export default function TripsPage() {
  return (
    <RequestShell>
      <h1 className="font-heading text-[1.75rem] leading-tight font-semibold sm:text-3xl">My trips</h1>
      <p className="mt-2 text-muted">Share a trip and see requests from people on exactly your route, in your direction.</p>
      <Suspense fallback={<p className="mt-6 text-muted">Loading your trips…</p>}>
        <Trips />
      </Suspense>
    </RequestShell>
  );
}

async function Trips() {
  const { supabase, user } = await requireUser("/trips");
  if (!MARKETPLACE_OPEN) {
    return (
      <div className="mt-6">
        <EmptyState title="Trips open soon">
          Orbitly is in an early public preview. You’ll be able to share a trip here and see matching requests once the marketplace opens.
        </EmptyState>
      </div>
    );
  }

  const { data, error } = await supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("traveller_id", user.id)
    .order("departure_date", { ascending: true })
    .limit(50)
    .returns<TripRow[]>();
  if (error) {
    console.error("[trips] list failed", { code: error.code });
    return (
      <p role="alert" className="mt-6 text-danger">
        We couldn’t load your trips. Please refresh the page to try again.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      {data.length > 0 && (
        <ul className="space-y-3">
          {data.map((t) => {
            const s = tripStatus(t);
            return (
              <li key={t.id}>
                <Link href={`/trips/${t.id}`} className="flex items-center justify-between gap-3 rounded-card border border-line bg-white p-4 hover:border-teal focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none">
                  <span className="min-w-0">
                    <span className="block font-semibold break-words">{routeLabel(t.departure_country, t.destination_country)}</span>
                    <span className="mt-0.5 block text-sm text-muted">
                      {formatDate(t.departure_date)} → {formatDate(t.arrival_date)}
                    </span>
                  </span>
                  <Badge tone={s.live ? "success" : "neutral"}>{s.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <section aria-labelledby="new-trip">
        <h2 id="new-trip" className="mb-3 font-heading text-xl font-semibold">
          {data.length ? "Add another trip" : "Share your first trip"}
        </h2>
        <TripForm />
      </section>
    </div>
  );
}
