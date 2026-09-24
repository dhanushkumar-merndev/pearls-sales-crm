import type { Metadata, Viewport } from "next";
import { Geist_Mono, Playfair_Display, Roboto } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/query-provider";
import { OfflineBanner } from "@/components/shared/offline-banner";
import { ServiceWorkerRegister } from "@/components/shared/service-worker-register";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: "variable",
});

// Brand display face of pearlaesthetic.in -- login, sidebar lockup and print
// letterheads only; operational UI stays in Roboto for density.
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Pearl Aesthetic & Wellness Clinic", template: "%s | Pearl Aesthetic" },
  description: "Secure clinic operations and lead management for Pearl Aesthetic & Wellness Clinic",
  icons: { icon: "/favicon.ico", shortcut: "/favicon.ico", apple: "/apple-touch-icon.png" },
  // iOS ignores the web manifest for "Add to Home Screen" and reads these
  // meta tags instead to run the installed app in its own standalone window.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Pearl Aesthetic" },
};

export const viewport: Viewport = {
  themeColor: "#8A6D4B",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-IN"
      className={`${roboto.variable} ${playfair.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <QueryProvider>
          <OfflineBanner />
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </QueryProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
