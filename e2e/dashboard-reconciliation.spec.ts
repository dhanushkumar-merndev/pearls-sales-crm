import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { emailFor, signIn, type Role } from "./support/auth";

// Compare the rendered cards with underlying records, independently of the
// dashboard RPC. Run serially after workflows have finished writing fixtures.
for (const role of ["admin", "reception", "op", "doctor", "pharmacy", "sales_executive"] as Role[]) {
  test(`${role} dashboard counts and money reconcile to stored records`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Data reconciliation runs once; responsive layouts have separate coverage.");
    test.setTimeout(60_000);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const start = new Date(`${today}T00:00:00+05:30`).toISOString();
    const end = new Date(new Date(start).getTime() + 86_400_000).toISOString();
    const scan = async (table: string, columns: string, dated = false): Promise<Array<Record<string, unknown>>> => {
      const rows: Array<Record<string, unknown>> = [];
      for (let offset = 0; ; offset += 1000) {
        let query = db.from(table).select(columns).order("id").range(offset, offset + 999);
        if (dated) query = query.gte("created_at", start).lt("created_at", end);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const batch = data as unknown as Array<Record<string, unknown>>;
        rows.push(...batch);
        if (batch.length < 1000) return rows;
      }
    };
    const { data: profile, error } = await db.from("profiles").select("id,doctor_id").eq("email", emailFor(role)).single();
    if (error || !profile) throw new Error("The dashboard test role must exist.");
    const cards: Array<[string, number, boolean?]> = [];
    if (role === "sales_executive") {
      const leads = (await scan("leads", "id,assigned_to,status,next_follow_up_at,appointment_at,converted_at,received_at"))
        .filter(row => row.assigned_to === profile.id);
      const month = new Date(`${today.slice(0, 7)}-01T00:00:00+05:30`).getTime();
      const converted = leads.filter(row => row.status === "converted" && Date.parse(String(row.converted_at)) >= month).length;
      const received = leads.filter(row => Date.parse(String(row.received_at)) >= month).length;
      cards.push(
        ["New Leads", leads.filter(row => row.status === "new").length],
        ["Open Leads", leads.filter(row => ["new", "contacted", "interested", "booked"].includes(String(row.status))).length],
        ["Follow-ups Due", leads.filter(row => ["new", "contacted", "interested"].includes(String(row.status)) && row.next_follow_up_at && Date.parse(String(row.next_follow_up_at)) <= Date.now()).length],
        ["Appointments Today", leads.filter(row => ["booked", "converted"].includes(String(row.status)) && row.appointment_at && new Date(String(row.appointment_at)).toISOString() >= start && new Date(String(row.appointment_at)).toISOString() < end).length],
        ["Converted This Month", converted],
        ["Conversion % (Month)", received ? Math.round(converted * 100 / received) : 0],
      );
    } else {
      const visits = (await scan("visits", "id,patient_id,doctor_id,status,visit_date"))
        .filter(row => row.visit_date === today && (role !== "doctor" || row.doctor_id === profile.doctor_id));
      const waiting = visits.filter(row => ["waiting", "vitals_pending"].includes(String(row.status))).length;
      const completed = visits.filter(row => row.status === "completed").length;
      const ready = visits.filter(row => row.status === "ready").length;
      if (role !== "pharmacy") {
        cards.push([role === "doctor" ? "Waiting for Me" : "Waiting", waiting], ["Completed Today", completed]);
        if (role === "doctor") cards.push(["Ready for Me", ready]);
        if (role === "op" || role === "reception") cards.push(["Ready for Doctor", ready]);
        if (role === "op" || role === "admin") cards.push([role === "op" ? "Patients Today" : "Patients Seen Today", new Set(visits.map(row => row.patient_id)).size]);
        if (role === "admin" || role === "reception") cards.push([role === "admin" ? "OP Visits Today" : "Visits Today", visits.length]);
      }
      if (["admin", "reception", "pharmacy"].includes(role)) {
        const sales = await scan("pharmacy_sales", "id,total_paise,source", true);
        const pharmacyTotal = sales.reduce((sum, row) => sum + Number(row.total_paise), 0);
        if (role === "pharmacy") {
          cards.push(["Today's Sales", pharmacyTotal, true], ["Dispensed Today", sales.length]);
        } else {
          const payments = await scan("visit_payments", "id,amount_paise", true);
          const procedures = await scan("procedure_sales", "id,total_paise,payment_mode", true);
          const collected = payments.reduce((sum, row) => sum + Number(row.amount_paise), 0)
            + sales.filter(row => row.source === "op").reduce((sum, row) => sum + Number(row.total_paise), 0)
            + procedures.filter(row => row.payment_mode !== null).reduce((sum, row) => sum + Number(row.total_paise), 0);
          cards.push(["Collected Today", collected, true]);
        }
      }
      if (role === "pharmacy" || role === "admin") {
        const prescriptions = await scan("prescriptions", "id,status");
        cards.push(["Pending Prescriptions", prescriptions.filter(row => ["pending", "partially_dispensed"].includes(String(row.status))).length]);
      }
    }
    await signIn(page, role);
    await page.goto("/dashboard");
    for (const [label, value, money] of cards) {
      const formatted = money ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value / 100)
        : new Intl.NumberFormat("en-IN").format(value);
      await expect(page.getByRole("button", { name: `${label}: ${formatted}. Open details`, exact: true }), `${role}: ${label} matches source records`).toBeVisible();
    }
  });
}
