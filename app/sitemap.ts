import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: APP_URL }, { url: `${APP_URL}/connect` }];
}
