import { siteUrl } from "@/lib/redirect";

/** Absolute origin for canonical URLs, the sitemap and structured data. SITE_URL first, then Vercel's production URL. */
export function publicOrigin(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return siteUrl() ?? (vercel ? `https://${vercel}` : "http://localhost:3000");
}

export const SITE_NAME = "Orbitly";

/** Pages search engines should not list: sign-in, account and on-device request screens. Still crawlable, so the tag is seen. */
export const NOINDEX = { index: false, follow: true } as const;

/** The card from app/opengraph-image.tsx. Listed explicitly because a page's own openGraph drops the inherited file image. */
export const SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Orbitly: products travel with people",
};

/** Open Graph for one indexable page. Pages must set their own: a page's openGraph replaces the layout's entirely. */
export function openGraph(path: string, title: string, description: string) {
  return { type: "website", siteName: SITE_NAME, locale: "en_IN", url: path, title, description, images: [SHARE_IMAGE] };
}

export const TWITTER = { card: "summary_large_image", images: [SHARE_IMAGE] } as const;
