import { CITY_LIGHTS, GRID, LAND, PLACES } from "./globe-paths";

const G = { cx: 540, cy: 470, r: 318 };
const INDIA = PLACES.india;
// Main journey: from beyond the horizon (the Americas) over Europe, down to India.
const ROUTE = `M337 225C430 112 640 168 ${INDIA[0]} ${INDIA[1]}`;
const FEEDERS = [
  `M${PLACES.london[0]} ${PLACES.london[1]}C470 300 600 330 ${INDIA[0]} ${INDIA[1]}`,
  `M${PLACES.dubai[0]} ${PLACES.dubai[1]}C600 420 640 412 ${INDIA[0]} ${INDIA[1]}`,
  `M${PLACES.singapore[0]} ${PLACES.singapore[1]}C780 470 730 440 ${INDIA[0]} ${INDIA[1]}`,
];

/**
 * The auth page's cinematic illustration: a lit Earth at dusk seen from an observation deck,
 * a traveller (from behind) with luggage, a floating Orbitly parcel, an airliner and a glowing
 * route into India. One server-rendered SVG: shows with the HTML, no JS. Motion is CSS
 * transforms/opacity plus one SVG motion path; blur filters sit only on still layers.
 * Render once per page (it uses SVG ids). Decorative, hidden from assistive tech.
 */
export function CinematicScene({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 900 1024"
      preserveAspectRatio="xMaxYMid meet"
      className={`cinematic-scene ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="cs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0C2A66" />
          <stop offset="0.45" stopColor="#1B4A9A" />
          <stop offset="0.78" stopColor="#2F67B8" />
          <stop offset="1" stopColor="#15306A" />
        </linearGradient>
        <radialGradient id="cs-sunset" cx="0.9" cy="0.82" r="0.55">
          <stop offset="0" stopColor="#FFB27A" stopOpacity="0.55" />
          <stop offset="0.35" stopColor="#E9799A" stopOpacity="0.18" />
          <stop offset="1" stopColor="#E9799A" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cs-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.78" stopColor="#38E8F0" stopOpacity="0.55" />
          <stop offset="0.86" stopColor="#2E9BFF" stopOpacity="0.22" />
          <stop offset="1" stopColor="#2E9BFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cs-ocean" cx="0.34" cy="0.3" r="0.82">
          <stop offset="0" stopColor="#2C86E8" />
          <stop offset="0.4" stopColor="#1453B4" />
          <stop offset="0.8" stopColor="#0A2C75" />
          <stop offset="1" stopColor="#061A4A" />
        </radialGradient>
        <radialGradient id="cs-night" cx="0.28" cy="0.24" r="0.95">
          <stop offset="0.45" stopColor="#020818" stopOpacity="0" />
          <stop offset="0.85" stopColor="#020818" stopOpacity="0.55" />
          <stop offset="1" stopColor="#020818" stopOpacity="0.75" />
        </radialGradient>
        <linearGradient id="cs-land" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#5FD8B4" />
          <stop offset="0.5" stopColor="#2A9C8E" />
          <stop offset="1" stopColor="#17607A" />
        </linearGradient>
        <radialGradient id="cs-cloud" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.5" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cs-bank" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#4F8FE8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#4F8FE8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cs-light" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.3" stopColor="#7FFFF2" stopOpacity="0.9" />
          <stop offset="1" stopColor="#20C7B5" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cs-city" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFE7B0" />
          <stop offset="1" stopColor="#FFB45C" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cs-teal-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#20C7B5" stopOpacity="0.55" />
          <stop offset="1" stopColor="#20C7B5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cs-route" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#20C7B5" stopOpacity="0.15" />
          <stop offset="0.5" stopColor="#3FF0E0" />
          <stop offset="1" stopColor="#D6FFFB" />
        </linearGradient>
        <linearGradient id="cs-deck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#13285A" />
          <stop offset="1" stopColor="#050C20" />
        </linearGradient>
        <linearGradient id="cs-box-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F3D7A6" />
          <stop offset="1" stopColor="#D9AF72" />
        </linearGradient>
        <linearGradient id="cs-box-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#CF9C5C" />
          <stop offset="1" stopColor="#A9773F" />
        </linearGradient>
        <linearGradient id="cs-box-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9C6D38" />
          <stop offset="1" stopColor="#6E4A24" />
        </linearGradient>
        <linearGradient id="cs-jacket" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0C1833" />
          <stop offset="0.6" stopColor="#1A2E5C" />
          <stop offset="1" stopColor="#24427A" />
        </linearGradient>
        <linearGradient id="cs-pack" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#141F3C" />
          <stop offset="0.65" stopColor="#273D6C" />
          <stop offset="1" stopColor="#35558F" />
        </linearGradient>
        <linearGradient id="cs-case" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7F92B6" />
          <stop offset="0.55" stopColor="#C9D6EC" />
          <stop offset="1" stopColor="#E9F0FA" />
        </linearGradient>
        <linearGradient id="cs-fade-down" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <filter id="cs-blur-xl" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="30" />
        </filter>
        <filter id="cs-blur-md" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <filter id="cs-blur-sm" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <clipPath id="cs-globe-clip">
          <circle cx={G.cx} cy={G.cy} r={G.r} />
        </clipPath>
        <path id="cs-route-path" d={ROUTE} />
      </defs>

      {/* Sky, sunset and distant stars */}
      <rect x="-900" width="2700" height="1024" fill="url(#cs-sky)" />
      <rect x="-900" width="2700" height="1024" fill="url(#cs-sunset)" />
      <g fill="#F5F7FA">
        {[[60, 70, 1.1], [190, 40, 0.8], [840, 60, 1.2], [870, 210, 0.9], [40, 300, 0.9], [120, 180, 0.7], [700, 40, 0.8], [30, 520, 0.8]].map(
          ([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} opacity="0.5" />,
        )}
      </g>

      {/* Cloud banks around the Earth */}
      <g filter="url(#cs-blur-xl)">
        <ellipse cx="260" cy="640" rx="200" ry="70" fill="url(#cs-bank)" />
        <ellipse cx="820" cy="560" rx="160" ry="80" fill="url(#cs-bank)" />
        <ellipse cx="540" cy="820" rx="360" ry="70" fill="url(#cs-bank)" />
      </g>

      {/* Earth */}
      <circle cx={G.cx} cy={G.cy} r={G.r + 44} fill="url(#cs-halo)" className="cs-halo" />
      <circle cx={G.cx} cy={G.cy} r={G.r} fill="url(#cs-ocean)" />
      <g clipPath="url(#cs-globe-clip)">
        <path d={GRID} fill="none" stroke="#A9C8FF" strokeOpacity="0.07" strokeWidth="1" />
        <path d={LAND} fill="url(#cs-land)" opacity="0.92" />
        <path d={LAND} fill="none" stroke="#9BFFF1" strokeOpacity="0.55" strokeWidth="3" filter="url(#cs-blur-sm)" />
        <path d={LAND} fill="none" stroke="#C8FFF8" strokeOpacity="0.5" strokeWidth="0.8" strokeLinejoin="round" />
        <g className="cs-clouds">
          {[[330, 250, 120, 14, -12], [470, 380, 150, 12, 8], [700, 300, 130, 13, -18], [560, 610, 170, 14, 6], [400, 520, 110, 11, -6], [760, 560, 120, 12, 14], [620, 200, 100, 10, -4]].map(
            ([cx, cy, rx, ry, a]) => (
              <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#cs-cloud)" opacity="0.45" transform={`rotate(${a} ${cx} ${cy})`} />
            ),
          )}
        </g>
        <circle cx={G.cx} cy={G.cy} r={G.r} fill="url(#cs-night)" />
        <g className="cs-cities">
          {CITY_LIGHTS.map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="7" fill="url(#cs-city)" opacity="0.55" />
              <circle cx={x} cy={y} r="1.4" fill="#FFF1CF" />
            </g>
          ))}
        </g>
        <ellipse cx="430" cy="320" rx="150" ry="110" fill="#FFFFFF" opacity="0.08" filter="url(#cs-blur-xl)" />
      </g>
      <circle cx={G.cx} cy={G.cy} r={G.r - 1} fill="none" stroke="#8CF6FF" strokeOpacity="0.55" strokeWidth="2.5" filter="url(#cs-blur-sm)" />

      {/* Routes into India */}
      <g fill="none" strokeLinecap="round">
        {FEEDERS.map((d) => (
          <path key={d} d={d} stroke="#5BE3D4" strokeOpacity="0.4" strokeWidth="1.3" strokeDasharray="2 6" />
        ))}
        <path d={ROUTE} stroke="#20C7B5" strokeOpacity="0.45" strokeWidth="7" filter="url(#cs-blur-md)" />
        <path d={ROUTE} pathLength={1} stroke="url(#cs-route)" strokeWidth="2" strokeDasharray="1 1" className="cs-route-draw" />
      </g>
      {/* A light travelling along the route towards India */}
      <g className="cs-motion">
        <circle r="14" fill="url(#cs-light)">
          <animateMotion dur="6s" repeatCount="indefinite" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.42 0 0.58 1">
            <mpath href="#cs-route-path" />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.85;1" dur="6s" repeatCount="indefinite" />
        </circle>
      </g>
      {/* Origin points */}
      {[PLACES.london, PLACES.frankfurt, PLACES.dubai, PLACES.singapore].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="6" fill="url(#cs-teal-glow)" />
          <circle cx={x} cy={y} r="2.4" fill="#C9FFF8" />
        </g>
      ))}

      {/* India pin */}
      <g>
        <ellipse cx={INDIA[0]} cy={INDIA[1]} rx="16" ry="6" fill="none" stroke="#5BFFF0" strokeWidth="2" className="cs-pulse" />
        <ellipse cx={INDIA[0]} cy={INDIA[1]} rx="9" ry="3.5" fill="#20C7B5" opacity="0.6" />
        <circle cx={INDIA[0]} cy={INDIA[1] - 26} r="26" fill="url(#cs-teal-glow)" className="cs-pin-glow" />
        <path
          d={`M${INDIA[0]} ${INDIA[1]}C${INDIA[0] - 4} ${INDIA[1] - 10} ${INDIA[0] - 13} ${INDIA[1] - 17} ${INDIA[0] - 13} ${INDIA[1] - 27}A13 13 0 1 1 ${INDIA[0] + 13} ${INDIA[1] - 27}C${INDIA[0] + 13} ${INDIA[1] - 17} ${INDIA[0] + 4} ${INDIA[1] - 10} ${INDIA[0]} ${INDIA[1]}Z`}
          fill="#20C7B5"
          stroke="#D9FFFB"
          strokeWidth="1.5"
        />
        <circle cx={INDIA[0]} cy={INDIA[1] - 27} r="4.5" fill="#F5F7FA" />
      </g>

      {/* Airliner heading out to collect, linked to the parcel's journey */}
      <path d="M752 196C720 236 700 262 682 300" fill="none" stroke="#5BE3D4" strokeOpacity="0.5" strokeWidth="1.3" strokeDasharray="3 6" />
      <g className="cs-plane">
        <path d="M748 200L700 248" stroke="url(#cs-fade-down)" strokeWidth="3" strokeLinecap="round" transform="translate(4 4)" />
        <g transform="translate(772 170) rotate(45) scale(0.95)">
          {/* fuselage, wings, tailplane, engines — viewed from above */}
          <path d="M0 -40C3 -40 4.5 -34 4.5 -26L4.5 26C4.5 34 2 40 0 40C-2 40 -4.5 34 -4.5 26L-4.5 -26C-4.5 -34 -3 -40 0 -40Z" fill="#EEF3FB" />
          <path d="M4 -6L38 10L38 15L4 6ZM-4 -6L-38 10L-38 15L-4 6Z" fill="#D5DEEC" />
          <path d="M3 28L15 35L15 38L3 35ZM-3 28L-15 35L-15 38L-3 35Z" fill="#C5D0E2" />
          <rect x="13" y="0" width="5" height="10" rx="2.5" fill="#9AA9C3" />
          <rect x="-18" y="0" width="5" height="10" rx="2.5" fill="#9AA9C3" />
          <path d="M-2 -34H2" stroke="#20C7B5" strokeWidth="2" strokeLinecap="round" />
        </g>
      </g>

      {/* Floating Orbitly parcel */}
      <g transform="translate(660 300)">
        <ellipse cx="0" cy="112" rx="70" ry="16" fill="url(#cs-teal-glow)" />
        <g className="cs-parcel">
          <path d="M0 -54L66 -20L0 14L-66 -20Z" fill="url(#cs-box-top)" />
          <path d="M-66 -20L0 14L0 92L-66 58Z" fill="url(#cs-box-left)" />
          <path d="M0 14L66 -20L66 58L0 92Z" fill="url(#cs-box-right)" />
          <path d="M-34 -37L32 -3L42 -8L-24 -42Z" fill="#20C7B5" />
          <path d="M32 -3L42 -8L42 70L32 75Z" fill="#139D8F" />
          <path d="M-66 -20L0 14L66 -20" fill="none" stroke="#FFF2D8" strokeOpacity="0.7" strokeWidth="1.2" />
          <path d="M0 14V92" stroke="#FFFFFF" strokeOpacity="0.18" />
          <path d="M66 -20V58" stroke="#5BFFF0" strokeOpacity="0.55" strokeWidth="1.5" />
          {/* Orbitly mark on the side */}
          <g transform="matrix(1 0.52 0 1 -42 26)">
            <circle cx="0" cy="0" r="8" fill="#20C7B5" />
            <ellipse cx="0" cy="0" rx="13" ry="4.5" fill="none" stroke="#F5F7FA" strokeWidth="1.6" transform="rotate(-20)" />
          </g>
        </g>
      </g>

      {/* Distant skyline and Gateway of India, warmed by the sunset */}
      <g opacity="0.85">
        <path d="M480 842V826H496V812H510V832H530V820H548V842ZM560 842V830H578V816H590V842ZM870 842V824H884V842Z" fill="#0C1C42" />
        <g fill="#0B1A3D" stroke="#FFB27A" strokeOpacity="0.35" strokeWidth="1">
          <path d="M714 842V790H726V770H734V790H754V762C754 748 766 738 782 738C798 738 810 748 810 762V790H830V770H838V790H850V842H796V804C796 794 790 786 782 786C774 786 768 794 768 804V842Z" />
          <path d="M726 770L730 760L734 770ZM830 770L834 760L838 770ZM770 738C770 728 776 722 782 722C788 722 794 728 794 738Z" />
          <rect x="750" y="742" width="64" height="6" rx="1" />
        </g>
      </g>

      {/* Observation deck: floor, glass railing, reflections */}
      <rect x="-900" y="842" width="2700" height="182" fill="url(#cs-deck)" />
      <ellipse cx="540" cy="880" rx="300" ry="26" fill="#3FC9E8" opacity="0.18" filter="url(#cs-blur-md)" />
      <ellipse cx="820" cy="880" rx="120" ry="16" fill="#FFB27A" opacity="0.2" filter="url(#cs-blur-md)" />
      <g stroke="#8CD9FF" strokeOpacity="0.35">
        <path d="M-900 800H1800" strokeWidth="2" />
        <path d="M-900 842H1800" strokeOpacity="0.2" />
        {[-660, -480, -300, -120, 60, 240, 420, 600, 780].map((x) => (
          <path key={x} d={`M${x} 800V842`} strokeOpacity="0.25" />
        ))}
      </g>
      <rect x="-900" y="800" width="2700" height="42" fill="#9FD6FF" opacity="0.05" />

      {/* Traveller, seen from behind, looking at the Earth */}
      <g transform="translate(200 970)">
        <Traveller />
      </g>
    </svg>
  );
}

function Traveller() {
  return (
    <g>
      {/* shadow and floor reflections */}
      <ellipse cx="30" cy="6" rx="110" ry="14" fill="#01040D" opacity="0.55" filter="url(#cs-blur-md)" />
      <rect x="66" y="8" width="60" height="40" rx="10" fill="url(#cs-case)" opacity="0.08" />
      <rect x="-30" y="8" width="60" height="44" rx="10" fill="#1A2E5C" opacity="0.12" />

      {/* suitcase stays grounded */}
      <g>
        <path d="M84 -126V-160M108 -126V-160" stroke="#8E9DB8" strokeWidth="4" strokeLinecap="round" />
        <path d="M82 -162H110" stroke="#56627C" strokeWidth="7" strokeLinecap="round" />
        <rect x="66" y="-128" width="60" height="124" rx="13" fill="url(#cs-case)" />
        <path d="M80 -116V-16M96 -116V-16M112 -116V-16" stroke="#6F82A6" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
        <rect x="66" y="-128" width="60" height="124" rx="13" fill="none" stroke="#FFFFFF" strokeOpacity="0.45" />
        <path d="M126 -110V-20" stroke="#5BFFF0" strokeOpacity="0.5" strokeWidth="1.5" />
        <circle cx="76" cy="-2" r="5" fill="#1B2440" />
        <circle cx="116" cy="-2" r="5" fill="#1B2440" />
      </g>

      {/* legs and shoes */}
      <path d="M-30 -136H-6V-12H-30Z" fill="url(#cs-jacket)" />
      <path d="M6 -136H30V-12H6Z" fill="url(#cs-jacket)" />
      <path d="M30 -130V-14" stroke="#5BFFF0" strokeOpacity="0.4" strokeWidth="1.5" />
      <rect x="-34" y="-16" width="30" height="16" rx="7" fill="#0A1124" />
      <rect x="4" y="-16" width="30" height="16" rx="7" fill="#0A1124" />
      <path d="M-33 -3H-5M5 -3H33" stroke="#D9E2F0" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />

      <g className="cs-breathe">
        {/* arms */}
        <path d="M-44 -232Q-58 -190 -56 -142" stroke="url(#cs-jacket)" strokeWidth="22" strokeLinecap="round" fill="none" />
        <circle cx="-56" cy="-136" r="9" fill="#8A5A3C" />
        <path d="M44 -232Q70 -200 94 -164" stroke="url(#cs-jacket)" strokeWidth="22" strokeLinecap="round" fill="none" />
        <circle cx="96" cy="-160" r="9" fill="#8A5A3C" />

        {/* jacket */}
        <path d="M-50 -128C-54 -170 -58 -216 -46 -240Q-30 -254 0 -256Q30 -254 46 -240C58 -216 54 -170 50 -128Z" fill="url(#cs-jacket)" />
        <path d="M46 -238C56 -214 54 -170 50 -130" fill="none" stroke="#5BFFF0" strokeOpacity="0.45" strokeWidth="2" />

        {/* backpack */}
        <path d="M-30 -246C-36 -228 -38 -200 -36 -180M30 -246C36 -228 38 -200 36 -180" stroke="#0E1730" strokeWidth="9" strokeLinecap="round" fill="none" />
        <rect x="-38" y="-236" width="76" height="104" rx="20" fill="url(#cs-pack)" />
        <rect x="-26" y="-176" width="52" height="38" rx="11" fill="#1B2B52" />
        <path d="M-22 -178H22" stroke="#4E6BA6" strokeOpacity="0.6" strokeWidth="2" strokeLinecap="round" />
        <path d="M-12 -244Q0 -254 12 -244" stroke="#2E4677" strokeWidth="5" fill="none" strokeLinecap="round" />
        <rect x="-38" y="-236" width="76" height="104" rx="20" fill="none" stroke="#5BFFF0" strokeOpacity="0.35" strokeWidth="1.5" />
        <rect x="-6" y="-214" width="12" height="7" rx="2" fill="#20C7B5" />

        {/* neck and head, from behind */}
        <rect x="-10" y="-268" width="20" height="16" rx="7" fill="#7A4D33" />
        <circle cx="-23" cy="-284" r="5" fill="#8A5A3C" />
        <circle cx="23" cy="-284" r="5" fill="#8A5A3C" />
        <ellipse cx="0" cy="-288" rx="23" ry="27" fill="#131A2C" />
        <path d="M18 -306C24 -296 24 -280 19 -268" fill="none" stroke="#5BFFF0" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="-8" cy="-304" rx="9" ry="5" fill="#FFFFFF" opacity="0.06" />
      </g>
    </g>
  );
}
