import { Badge } from "@/components/ui/badge";

/**
 * How busy a consultant already is, shown inside the dropdown so reception
 * can spread the load instead of guessing: today's live queue (waiting or in
 * consultation).
 */
export function DoctorLoad({ opActive }: { opActive?: number | undefined }) {
  if (opActive === undefined) return null;
  if (!opActive) return <span className="text-xs text-muted-foreground">free</span>;
  return (
    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
      OP {opActive}
    </Badge>
  );
}
