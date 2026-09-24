import { redirect } from "next/navigation";
import { hasSupabaseEnv } from "@/lib/env";

export default function Home() {
  redirect(hasSupabaseEnv() ? "/dashboard" : "/setup");
}
