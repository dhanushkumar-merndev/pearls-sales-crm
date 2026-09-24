import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="space-y-5"><div className="space-y-2"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-80 max-w-full" /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-80" /></div>;
}
