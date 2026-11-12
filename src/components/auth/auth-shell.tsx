import { existsSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";
import { OrbitlyLogo } from "@/components/brand/orbitly-logo";
import { CinematicScene } from "./cinematic-scene";

// Drop the rendered artwork here (ideally without text or cards baked in) and it replaces the
// vector illustration automatically.
const SCENE_IMAGE = "/auth/scene.webp";
const hasSceneImage = existsSync(join(process.cwd(), "public", SCENE_IMAGE));

const HOOK_SUPPORT = "Discover what’s out there. Let your next journey bring it closer.";

/**
 * Auth layout from the reference: white form panel on the left (rounded edge over the scene),
 * the journey scene with its headline and status cards on the right. Phones/tablets: logo,
 * a compact scene card, then the form.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="relative grid flex-1 grid-cols-1 overflow-x-clip bg-white font-sans text-[#0F1F3D] [grid-template-areas:'brand''scene''form'] lg:min-h-dvh lg:grid-cols-[minmax(420px,30.4%)_1fr] lg:grid-rows-[auto_1fr] lg:bg-[#0B2350] lg:[grid-template-areas:'brand_scene''form_scene']">
      {/* White panel behind brand + form on desktop, with the rounded edge over the scene */}
      <div aria-hidden="true" className="absolute inset-y-0 left-0 z-10 hidden w-[max(420px,30.4%)] rounded-r-[1.75rem] bg-white shadow-[12px_0_40px_-20px_rgba(4,15,40,0.45)] lg:block" />

      <header className="relative z-20 px-5 pt-4 [grid-area:brand] sm:pt-6 sm:px-10 lg:px-[clamp(2.5rem,3.8vw,4.5rem)] lg:pt-[clamp(2rem,5.5vh,3.5rem)]">
        <OrbitlyLogo className="w-[84px] sm:w-[150px] lg:w-[172px]" />
        {/* Phones/tablets: the scene's headline is hidden there, so the hook sits under the logo instead. */}
        <div className="mt-3 sm:mt-5 lg:hidden">
          <p className="font-[family-name:var(--font-display)] text-[1.2rem] leading-snug font-semibold text-balance text-[#0F2C6B] sm:text-[1.65rem]">
            Some things are just <span className="text-[#0F7A6E]">closer</span> than you think.
          </p>
          {/* Short phones drop this line so the sign-in options stay on the first screen. */}
          <p className="mt-1 text-sm leading-relaxed text-[#5B6B86] max-sm:[@media(max-height:820px)]:hidden sm:mt-1.5 sm:text-[0.95rem]">{HOOK_SUPPORT}</p>
        </div>
      </header>

      <aside
        aria-hidden="true"
        className={`pointer-events-none relative mx-auto mt-4 overflow-hidden sm:mt-5 rounded-3xl [grid-area:scene] lg:mx-0 lg:mt-0 lg:-ml-8 lg:aspect-auto lg:w-auto lg:rounded-none ${
          hasSceneImage ? "aspect-[16/10] w-[calc(100%-2.5rem)] sm:w-[min(620px,calc(100%-5rem))]" : "aspect-[900/1024] w-[min(150px,40vw,15dvh)] sm:w-[min(260px,64vw,24dvh)]"
        }`}
      >
        {hasSceneImage ? (
          <Image src={SCENE_IMAGE} alt="" fill priority sizes="(min-width: 1024px) 70vw, 100vw" className="object-cover" />
        ) : (
          <CinematicScene className="absolute inset-0 h-full w-full" />
        )}

        <div className="absolute inset-x-0 top-0 hidden h-1/2 bg-gradient-to-b from-[#071A3F]/55 to-transparent lg:block" />
        <div className="absolute top-[8%] left-[calc(5.5%+2rem)] hidden max-w-[32rem] text-white lg:block">
          <p className="font-[family-name:var(--font-display)] text-[clamp(2rem,2.75vw,3.1rem)] leading-[1.18] font-semibold tracking-[-0.01em] [text-shadow:0_2px_18px_rgba(3,12,35,0.45)]">
            Some things are just
            <br />
            <span className="text-[#5BE8DA]">closer</span> than you think.
          </p>
          <p className="mt-4 max-w-[24rem] text-[clamp(0.98rem,1.1vw,1.1rem)] leading-relaxed text-white/85 [text-shadow:0_1px_10px_rgba(3,12,35,0.5)]">
            {HOOK_SUPPORT}
          </p>
        </div>

        <div className="auth-card absolute top-[11%] left-[61%] hidden items-center gap-3 rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-[1.05rem] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)] backdrop-blur-md xl:flex">
          <span className="grid size-9 place-items-center rounded-xl bg-white/90 text-[#0F2C6B]">
            <PlaneIcon />
          </span>
          London → Mumbai
        </div>

        <div className="auth-card absolute top-[61%] right-[1.2%] hidden items-center gap-3 rounded-2xl bg-white px-4 py-3 text-[0.92rem] leading-snug font-medium text-[#0F1F3D] shadow-[0_14px_36px_-14px_rgba(0,0,0,0.55)] [animation-delay:-3s] lg:flex">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#22B357] text-white">
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
            </svg>
          </span>
          <span>
            A traveller on
            <br />
            your route
          </span>
        </div>
      </aside>

      <main className="relative z-20 flex flex-col px-5 pt-5 pb-8 sm:pt-6 sm:pb-10 [grid-area:form] sm:px-10 lg:px-[clamp(2.5rem,3.8vw,4.5rem)] lg:pt-0 lg:pb-[clamp(1.5rem,4vh,3rem)]">
        <div className="mx-auto flex w-full max-w-[446px] flex-1 flex-col justify-center lg:mx-0">
          <h1 className="font-[family-name:var(--font-display)] text-[1.6rem] leading-tight sm:text-[clamp(1.75rem,2.2vw,2.1rem)] font-semibold text-[#0F2C6B]">
            {title}
          </h1>
          <p className="mt-1 text-base text-[#5B6B86] sm:mt-2 sm:text-[1.05rem]">{subtitle}</p>
          <div className="mt-5 sm:mt-8">{children}</div>
          <div className="mt-6 text-center text-[0.95rem] text-[#5B6B86] sm:mt-8">{footer}</div>
        </div>
      </main>
    </div>
  );
}

function PlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 13.5 4 11l1.5-1.5 7 1 4-4a2 2 0 0 1 3 3l-4 4 1 7L15 22l-2.5-6.5L9 19v2.5L7.5 23 6 19l-4-1.5L3.5 16H6z" />
    </svg>
  );
}
