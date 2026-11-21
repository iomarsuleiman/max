import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config";
import { GUIDES } from "@/lib/docs";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: APP_URL }, { url: `${APP_URL}/connect` }, { url: `${APP_URL}/docs` }, ...GUIDES.map((g) => ({ url: `${APP_URL}/docs/${g.slug}` }))];
}
