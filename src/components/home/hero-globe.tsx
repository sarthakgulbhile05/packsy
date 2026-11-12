import { GRID, LAND, PLACES } from "@/components/auth/globe-paths";

const G = { cx: 540, cy: 470, r: 318 };
const [IX, IY] = PLACES.india;

// Routes in both directions: two into India, two out of it. Curves bow upward like flight paths on a globe;
// an outbound route is the same curve drawn from India, so its travelling dot moves the other way.
const curve = (at: readonly [number, number], c1: string, c2: string, out: boolean) =>
  out ? `M${IX} ${IY}C${c2} ${c1} ${at.join(" ")}` : `M${at.join(" ")}C${c1} ${c2} ${IX} ${IY}`;
const NEW_YORK = [337, 225] as const;
const ROUTES = [
  { name: "New York", at: NEW_YORK, d: curve(NEW_YORK, "430 112", "640 168", true), label: [250, 205] as const },
  { name: "London", at: PLACES.london, d: curve(PLACES.london, "470 250", "610 300", false), label: [300, 268] as const },
  { name: "Dubai", at: PLACES.dubai, d: curve(PLACES.dubai, "600 400", "640 400", true), label: [500, 480] as const },
  { name: "Singapore", at: PLACES.singapore, d: curve(PLACES.singapore, "790 460", "730 420", false), label: [745, 580] as const },
];

/**
 * Homepage hero: a calm line-drawn Earth with travellers' routes into and out of India. Server-rendered
 * SVG (shares the projected coastlines with the auth scene), CSS-only motion, decorative.
 * Render once per page (it uses SVG ids).
 */
export function HeroGlobe({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="170 120 750 720" className={`hero-globe ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="hg-ocean" cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#1C3566" />
          <stop offset="0.6" stopColor="#13264B" />
          <stop offset="1" stopColor="#0A1329" />
        </radialGradient>
        <radialGradient id="hg-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.82" stopColor="#20C7B5" stopOpacity="0.22" />
          <stop offset="1" stopColor="#20C7B5" stopOpacity="0" />
        </radialGradient>
        <clipPath id="hg-clip">
          <circle cx={G.cx} cy={G.cy} r={G.r} />
        </clipPath>
      </defs>

      <circle cx={G.cx} cy={G.cy} r={G.r + 40} fill="url(#hg-halo)" />
      <circle cx={G.cx} cy={G.cy} r={G.r} fill="url(#hg-ocean)" />
      <g clipPath="url(#hg-clip)">
        <path d={GRID} fill="none" stroke="#FFFFFF" strokeOpacity="0.07" strokeWidth="1" />
        <path d={LAND} fill="#20C7B5" fillOpacity="0.16" stroke="#7FE6DA" strokeOpacity="0.55" strokeWidth="1.2" strokeLinejoin="round" />
      </g>
      <circle cx={G.cx} cy={G.cy} r={G.r} fill="none" stroke="#FFFFFF" strokeOpacity="0.14" strokeWidth="1.5" />

      {ROUTES.map((r, i) => (
        <g key={r.name}>
          <path d={r.d} pathLength={1} fill="none" stroke="#20C7B5" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="0.012 0.012" />
          <path
            d={r.d}
            pathLength={1}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="3.5"
            strokeLinecap="round"
            className="hg-travel"
            style={{ animationDelay: `${i * -1.3}s` }}
          />
          <circle cx={r.at[0]} cy={r.at[1]} r="6" fill="#FFFFFF" />
          <circle cx={r.at[0]} cy={r.at[1]} r="11" fill="none" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="1.5" />
          <text x={r.label[0]} y={r.label[1]} fill="#FFFFFF" fillOpacity="0.9" fontSize="26" fontWeight="500" letterSpacing="0.5">
            {r.name}
          </text>
        </g>
      ))}

      {/* The hub today: routes start or end here */}
      <circle cx={IX} cy={IY} r="16" fill="#20C7B5" className="hg-pulse" />
      <circle cx={IX} cy={IY} r="10" fill="#20C7B5" stroke="#FFFFFF" strokeWidth="3" />
      <g transform={`translate(${IX + 24} ${IY + 8})`}>
        <rect x="0" y="-24" width="88" height="36" rx="18" fill="#FFFFFF" />
        <text x="44" y="0" textAnchor="middle" fill="#101C35" fontSize="20" fontWeight="700">
          India
        </text>
      </g>
    </svg>
  );
}
