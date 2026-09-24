import { LeadListPage, type LeadSearch } from "@/features/leads/list-page";
export default function Page({ searchParams }: { searchParams: Promise<LeadSearch> }) { return <LeadListPage searchParams={searchParams} mode="booked" />; }
