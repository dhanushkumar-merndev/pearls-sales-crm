import type { MetadataRoute } from "next";

// Next.js's file-convention manifest -- auto-served at /manifest.webmanifest
// and auto-linked from every page's <head>. Makes the app installable
// (Add to Home Screen / desktop install prompt) with its own window, icon
// and splash screen instead of just being a browser tab.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pearl Aesthetic & Wellness Clinic",
    short_name: "Pearl",
    description: "Clinic operations -- leads, reception, OP, doctor and pharmacy workflows.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#FDFBF7",
    theme_color: "#8A6D4B",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
