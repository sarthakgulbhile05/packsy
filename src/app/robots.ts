import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/site";

// Private pages aren't disallowed here: crawlers must fetch them to see their noindex tag.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/auth/" },
    sitemap: `${publicOrigin()}/sitemap.xml`,
  };
}
