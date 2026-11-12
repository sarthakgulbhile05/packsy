import Image from "next/image";
import Link from "next/link";
import logo from "../../../public/brand/orbitly-logo.png";

// The artwork has a white background. On white surfaces "multiply" makes it vanish; on coloured
// surfaces the "white" tone inverts it to a light monochrome mark and "screen" drops the background.
const TONES = {
  color: "mix-blend-multiply",
  white: "mix-blend-screen [filter:grayscale(1)_invert(1)_brightness(1.25)_contrast(1.6)]",
};

/**
 * The original Orbitly brand artwork: blue-and-teal globe with orbit swoosh, airliner and parcel,
 * above the lowercase "orbitly" wordmark. Cropped from the brand file.
 */
export function OrbitlyLogo({
  href = "/",
  tone = "color",
  className = "w-[124px] sm:w-[150px] lg:w-[172px]",
  priority = true,
}: {
  href?: string;
  tone?: keyof typeof TONES;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-block rounded-xl focus-visible:ring-4 focus-visible:ring-[#2F7BEF]/30 focus-visible:outline-none ${className}`}
    >
      <Image src={logo} alt="orbitly" priority={priority} sizes="(min-width: 1024px) 240px, 180px" className={`h-auto w-full ${TONES[tone]}`} />
    </Link>
  );
}
