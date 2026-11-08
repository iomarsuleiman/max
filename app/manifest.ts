import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Max",
    short_name: "Max",
    description: "A calm, private workspace for notes, nested pages and personal databases.",
    start_url: "/home",
    display: "standalone",
    background_color: "#f8f7f4",
    theme_color: "#f8f7f4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
