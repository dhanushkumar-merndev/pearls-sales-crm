import { Mail, MapPin, Phone } from "lucide-react";
import { CLINIC_NAME, HospitalWordmark } from "@/components/shared/hospital-logo";
import type { HospitalIdentity } from "@/lib/print/hospital-identity";
import { cn } from "@/lib/utils";

/**
 * The printed letterhead, identical on every document the clinic hands out --
 * token, prescription, receipt, procedure bill.
 *
 *     [ PEARL wordmark ]                            address
 *     tagline                                       phone
 *                                                   email
 *
 * The Pearl wordmark already spells the clinic name, so the name is printed
 * as text only when settings rename the clinic to something the artwork does
 * not say. Identity on the left, contact details on the right, the
 * document's own details underneath.
 */
export function HospitalLetterhead({
  identity,
  logoSize = 56,
  className,
}: {
  identity: HospitalIdentity;
  logoSize?: number;
  className?: string;
}) {
  const name = identity.name.trim();
  const renamed = name.toLowerCase() !== CLINIC_NAME.toLowerCase();

  return (
    <div className={cn("flex w-full items-center justify-between gap-6", className)}>
      <div className="shrink-0">
        <HospitalWordmark height={logoSize} className="h-auto" />
        {renamed ? (
          <p className="mt-0.5 font-display text-base leading-tight font-semibold text-primary">{name}</p>
        ) : (
          <span className="sr-only">{name}</span>
        )}
        {identity.tagline ? (
          // One phrase; on a narrow token slip it would otherwise wrap per word.
          <p className="mt-0.5 text-[10px] leading-tight font-medium whitespace-nowrap text-primary/80">
            {identity.tagline}
          </p>
        ) : null}
      </div>
      <ContactBlock identity={identity} />
    </div>
  );
}

function ContactBlock({ identity }: { identity: HospitalIdentity }) {
  const lines: Array<[React.ComponentType<{ className?: string }>, string]> = [];
  if (identity.address) lines.push([MapPin, identity.address]);
  if (identity.phone) lines.push([Phone, identity.phone]);
  if (identity.email) lines.push([Mail, identity.email]);
  if (!lines.length) return null;

  return (
    <div className="min-w-0 space-y-0.5 text-[9.5px] leading-snug">
      {lines.map(([Icon, value]) => (
        // The icon is inline rather than a flex sibling: a wrapping address
        // otherwise left the pin stranded on its own at the far left.
        <p className="max-w-[62mm] text-right" key={value}>
          <Icon className="mr-1 inline size-2.5 align-[-1.5px] text-primary" />
          {value}
        </p>
      ))}
    </div>
  );
}
