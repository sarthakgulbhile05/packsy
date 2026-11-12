import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/site";

/** Only the public, indexable pages. Sign-in, account and request screens are noindex and stay out. */
const SITEMAP_PATHS = ["/", "/travel"];

export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP_PATHS.map((path) => ({ url: new URL(path, publicOrigin()).href }));
}
