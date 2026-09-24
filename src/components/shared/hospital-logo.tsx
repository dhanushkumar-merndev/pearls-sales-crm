import Image from "next/image";
import { cn } from "@/lib/utils";

export const CLINIC_NAME = "Pearl Aesthetic & Wellness Clinic";

/**
 * The round gold Pearl emblem (transparent background), for square slots:
 * sidebar, favicon-sized marks, compact print slips.
 */
export function HospitalLogo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo-mark.png"
      alt={CLINIC_NAME}
      width={size}
      height={size}
      priority
      className={cn("object-contain", className)}
    />
  );
}

/**
 * The full "PEARL — Aesthetic & Wellness Clinic" lockup (emblem + wordmark,
 * 403×159 source). Use where the clinic name should read as the brand itself:
 * login card and printed letterheads.
 */
export function HospitalWordmark({ height = 56, className }: { height?: number; className?: string }) {
  const width = Math.round((height * 403) / 159);
  return (
    <Image
      src="/logo.png"
      alt={CLINIC_NAME}
      width={width}
      height={height}
      priority
      className={cn("object-contain", className)}
    />
  );
}
