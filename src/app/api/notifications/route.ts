import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  HospitalNotification,
  NotificationResponse,
} from "@/types/notifications";

export const dynamic = "force-dynamic";

type DashboardSummary = Record<string, number>;
type PendingNotification = Omit<HospitalNotification, "read">;

function value(summary: DashboardSummary, key: string) {
  return Number(summary[key] ?? 0);
}

function notification(
  kind: string,
  count: number,
  title: string,
  description: string,
  href: string,
  tone: PendingNotification["tone"] = "default",
): PendingNotification | null {
  if (count <= 0) return null;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  return {
    id: `${kind}:${day}:${count}`,
    title,
    description,
    href,
    count,
    tone,
  };
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  const summaryPromise = supabase.rpc("dashboard_summary");
  const doctorReportsPromise =
    profile.role === "doctor" && profile.doctorId
      ? supabase
          .from("patient_reports")
          .select("id,visits!inner(doctor_id)", { count: "exact", head: true })
          .eq("status", "ready")
          .eq("visits.doctor_id", profile.doctorId)
      : Promise.resolve({ count: 0 });
  const [summaryResult, doctorReportsResult] = await Promise.all([
    summaryPromise,
    doctorReportsPromise,
  ]);
  const summary = (summaryResult.data ?? {}) as DashboardSummary;
  const notices: Array<PendingNotification | null> = [];

  if (profile.role === "doctor") {
    const queue = value(summary, "waiting") + value(summary, "ready");
    notices.push(
      notification(
        "doctor-queue",
        queue,
        "Patients waiting for you",
        `${queue} patient${queue === 1 ? " is" : "s are"} waiting or ready for consultation.`,
        "/doctor",
        "warning",
      ),
      notification(
        "doctor-reports",
        doctorReportsResult.count ?? 0,
        "Reports ready for review",
        `${doctorReportsResult.count ?? 0} report${doctorReportsResult.count === 1 ? " is" : "s are"} linked to your OP visits.`,
        "/doctor/follow-ups",
      ),
    );
  } else if (profile.role === "pharmacy") {
    const pending = value(summary, "pending_prescriptions");
    const low = value(summary, "low_stock") + value(summary, "out_of_stock");
    notices.push(
      notification(
        "pharmacy-prescriptions",
        pending,
        "Pending prescriptions",
        `${pending} prescription${pending === 1 ? " requires" : "s require"} dispensing action.`,
        "/pharmacy",
        "warning",
      ),
      notification(
        "pharmacy-stock",
        low,
        "Stock needs attention",
        `${value(summary, "low_stock")} low-stock and ${value(summary, "out_of_stock")} out-of-stock batches.`,
        "/pharmacy/stock",
        "critical",
      ),
    );
  } else if (profile.role === "op") {
    const vitals = value(summary, "vitals_pending");
    const reportsPending = value(summary, "reports_pending");
    notices.push(
      notification(
        "op-vitals",
        vitals,
        "Vitals pending",
        `${vitals} visit${vitals === 1 ? " needs" : "s need"} vitals or readiness action.`,
        "/op",
        "warning",
      ),
      notification(
        "op-reports",
        reportsPending,
        "Reports pending",
        `${reportsPending} investigation report${reportsPending === 1 ? " is" : "s are"} pending.`,
        "/reports",
      ),
    );
  } else if (profile.role === "reception") {
    const followups = value(summary, "followups_due");
    const ready = value(summary, "reports_ready");
    const appointments = value(summary, "lead_appointments_today");
    notices.push(
      notification(
        "reception-lead-appointments",
        appointments,
        "Lead appointments today",
        `${appointments} booked lead${appointments === 1 ? " is" : "s are"} due at the clinic today.`,
        "/reception/lead-appointments",
      ),
      notification(
        "reception-followups",
        followups,
        "Follow-ups due",
        `${followups} patient follow-up${followups === 1 ? " is" : "s are"} due.`,
        "/reception/follow-ups",
        "warning",
      ),
      notification(
        "reception-reports",
        ready,
        "Reports ready",
        `${ready} uploaded report${ready === 1 ? " is" : "s are"} ready for the next workflow step.`,
        "/reports",
      ),
    );
  } else if (profile.role === "sales_executive") {
    const fresh = value(summary, "leads_new");
    const due = value(summary, "leads_followups_due");
    notices.push(
      notification(
        "sales-new-leads",
        fresh,
        "New leads assigned",
        `${fresh} new lead${fresh === 1 ? " is" : "s are"} waiting for first contact.`,
        "/leads?status=new",
        "warning",
      ),
      notification(
        "sales-followups",
        due,
        "Lead follow-ups due",
        `${due} lead follow-up${due === 1 ? " is" : "s are"} due now.`,
        "/leads/follow-ups",
      ),
    );
  } else {
    const queue = value(summary, "waiting") + value(summary, "ready");
    const stock = value(summary, "low_stock") + value(summary, "out_of_stock");
    notices.push(
      notification(
        "admin-queue",
        queue,
        "Live queue attention",
        `${queue} patient${queue === 1 ? " is" : "s are"} waiting or ready.`,
        "/doctor",
        "warning",
      ),
      notification(
        "admin-pharmacy",
        value(summary, "pending_prescriptions"),
        "Pending prescriptions",
        `${value(summary, "pending_prescriptions")} prescription${value(summary, "pending_prescriptions") === 1 ? " requires" : "s require"} pharmacy action.`,
        "/pharmacy",
        "warning",
      ),
      notification(
        "admin-stock",
        stock,
        "Stock alerts",
        `${value(summary, "low_stock")} low-stock and ${value(summary, "out_of_stock")} out-of-stock batches.`,
        "/pharmacy/stock",
        "critical",
      ),
      notification(
        "admin-reports",
        value(summary, "reports_ready"),
        "Reports ready",
        `${value(summary, "reports_ready")} report${value(summary, "reports_ready") === 1 ? " is" : "s are"} ready.`,
        "/reports",
      ),
      notification(
        "admin-unassigned-leads",
        value(summary, "leads_unassigned"),
        "Unassigned leads",
        `${value(summary, "leads_unassigned")} lead${value(summary, "leads_unassigned") === 1 ? " has" : "s have"} no sales executive yet.`,
        "/leads?owner=unassigned",
        "warning",
      ),
    );
  }

  const active = notices.filter(
    (item): item is PendingNotification => item !== null,
  );
  const { data: reads } = active.length
    ? await supabase
        .from("notification_reads")
        .select("notification_key")
        .eq("user_id", profile.id)
        .in(
          "notification_key",
          active.map((item) => item.id),
        )
    : { data: [] };
  const readKeys = new Set(
    (reads ?? []).map((item) => item.notification_key as string),
  );
  const items = active.map((item) => ({
    ...item,
    read: readKeys.has(item.id),
  }));
  const unreadCount = items.filter((item) => !item.read).length;
  const scope = request.nextUrl.searchParams.get("scope") === "unread" ? "unread" : "all";
  const pageSize = positiveInteger(request.nextUrl.searchParams.get("pageSize"), 10, 20);
  const requestedPage = positiveInteger(request.nextUrl.searchParams.get("page"), 1, 10_000);
  const scopedItems = scope === "unread" ? items.filter((item) => !item.read) : items;
  const totalItems = scopedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const response: NotificationResponse = {
    items: scopedItems.slice(offset, offset + pageSize),
    unreadCount,
    pagination: { page, pageSize, totalItems, totalPages },
  };
  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

const readSchema = z.object({
  ids: z.array(z.string().min(3).max(200)).min(1).max(20),
});

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  const parsed = readSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid notification selection" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("notification_reads").upsert(
    parsed.data.ids.map((id) => ({
      user_id: profile.id,
      notification_key: id,
      read_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,notification_key" },
  );
  if (error)
    return NextResponse.json({ error: "Notifications could not be updated" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
