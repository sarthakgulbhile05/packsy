import Link from "next/link";
import { OrbitlyLogo } from "@/components/brand/orbitly-logo";
import { primaryButton } from "@/components/request/ui";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col bg-[#F5F7FA] font-sans text-[#101C35]">
      <header className="border-b border-[#E3E8F0] bg-white">
        <div className="mx-auto flex w-full max-w-2xl items-center px-5 py-3">
          <OrbitlyLogo className="w-[84px]" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-16 text-center">
        <p className="text-sm font-semibold text-[#0F7A6E]">404</p>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold text-[#101C35]">We couldn’t find that page</h1>
        <p className="mt-2 text-[#5B6B86]">The link may be old or mistyped. You can start a request from the home page.</p>
        <Link href="/" className={`${primaryButton} mt-6`}>
          Go to the home page
        </Link>
      </main>
    </div>
  );
}
