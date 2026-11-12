import { connection } from "next/server";
import { getRates } from "@/lib/exchange-rates";

// Indicative display rates for the currency selector. Read-only and public: no user data in or out. The server
// keeps its own copy (src/lib/exchange-rates.ts), so a page view never costs more than one request here.
export async function GET() {
  await connection(); // per request, never frozen into the build
  const rates = await getRates();
  return Response.json(rates, {
    status: rates.ok ? 200 : 503,
    headers: { "Cache-Control": rates.ok ? "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400" : "no-store" },
  });
}
