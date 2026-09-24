/** Additive fictional examples. Normal workflow RPCs and constraints remain enabled.
 * node scripts/complete-pearl-demo.mjs --project <ref> --yes
 * The whole data change commits together; repeat runs leave existing examples alone.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrationClient } from "./migration-runner.mjs";

const marker = "pearl-demo-workflows-v1";
const args = process.argv.slice(2);
const db = await migrationClient();
try {
  if (!args.includes("--yes") || args[args.indexOf("--project") + 1] !== process.env.SUPABASE_PROJECT_ID) {
    throw new Error("Pass --project <matching project ref> --yes to add fictional demo records.");
  }
  await db.query("begin");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [marker]);
  const existing = await db.query("select count(*)::int n from patients where notes=$1", [marker]);
  if (existing.rows[0].n) {
    console.log("This demo dataset already exists; no records changed.");
    await db.query("rollback");
  } else {
    const admin = (await db.query("select id from profiles where email='admin@pearlaesthetic.in' and role='admin' and status='active'")).rows[0];
    const doctor = (await db.query("select id from doctors where registration_number='DEMO-001' and active")).rows[0];
    const sales = (await db.query("select id from profiles where email='sales@pearlaesthetic.in' and role='sales_executive' and status='active'")).rows[0];
    assert(admin && doctor && sales, "Create the Pearl admin, demo doctor and sales executive first.");
    // Use the application's role and normal RPC permissions within this transaction.
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: admin.id, role: "authenticated", app_metadata: { role: "admin" } })]);
    await db.query("set local role authenticated");
    const rpc = async (name, fields) => {
      const names = Object.keys(fields);
      const result = await db.query(`select * from public.${name}(${names.map((key, i) => `${key} => $${i + 1}`).join(",")})`, Object.values(fields).map(value => typeof value === "object" && value !== null ? JSON.stringify(value) : value));
      return result.rows[0];
    };
    const patient = async (name, phone) => (await db.query("insert into patients(name,phone_normalized,gender,notes) values($1,$2,'unknown',$3) returning id", [name, phone, marker])).rows[0];
    const visit = async (patientId) => rpc("create_visit_with_token", {
      p_patient_id: patientId, p_doctor_id: doctor.id, p_visit_type: "op", p_fee_paise: 0,
      p_collected_paise: 0, p_payment_mode: "cash", p_previous_visit_id: null,
      p_notes: marker, p_idempotency_key: randomUUID(),
    });
    const med = (await db.query("insert into medicine_directory(brand_name,generic_name,dosage_form,source) values('[Demo] Workflow Tablet','Fictional training item','Tablet',$1) returning id,brand_name", [marker])).rows[0];
    const savedBatch = await rpc("save_medicine_batch", {
      p_batch_id: null, p_medicine_id: med.id, p_batch_number: "DEMO-FLOW-001", p_expiry_date: "2028-12-31",
      p_quantity_delta: 100, p_purchase_price_paise: 300, p_selling_price_paise: 500,
      p_low_stock_threshold: 10, p_active: true, p_reason: "Fictional demonstration opening stock",
      p_idempotency_key: randomUUID(), p_units_per_pack: 1,
    });
    const batch = { id: savedBatch.save_medicine_batch };
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const pt = await patient(`[Demo] Workflow ${["Pharmacy Pending", "Dispensed", "Doctor Ready"][i]}`, `9${String(now + i).slice(-9)}`);
      const v = await visit(pt.id);
      await rpc("record_visit_vitals", { p_visit_id: v.visit_id, p_weight_kg: 65, p_height_cm: 165,
        p_temperature_f: 98.4, p_bp_systolic: 120, p_bp_diastolic: 80, p_pulse: 72,
        p_spo2: 98, p_respiratory_rate: 16, p_notes: "Fictional demo measurements" });
      if (i === 2) continue;
      await rpc("save_visit_consultation", { p_visit_id: v.visit_id, p_symptoms: "Fictional workflow demonstration",
        p_history: null, p_examination: null, p_assessment: "Demo only — not a clinical record", p_advice: "Training example only",
        p_follow_up_type: "none", p_follow_up_date: null, p_follow_up_days: null,
        p_medicines: [{ medicine_id: med.id, medicine_name: med.brand_name, dose: "Demo", quantity: 6 }],
        p_tests: [], p_complete: true, p_fee_paise: 150000, p_diagnoses: [] });
      if (i === 1) {
        const rx = (await db.query("select p.id,pi.id item_id from prescriptions p join prescription_items pi on pi.prescription_id=p.id where p.visit_id=$1", [v.visit_id])).rows[0];
        await rpc("dispense_prescription", { p_prescription_id: rx.id,
          p_lines: [{ prescription_item_id: rx.item_id, batch_id: batch.id, quantity: 6 }],
          p_payment_mode: "cash", p_idempotency_key: randomUUID(), p_consultation_collected_paise: 150000 });
      }
    }
    for (let i = 0; i < 5; i++) {
      const label = ["New", "Contacted", "Interested", "Booked", "Converted"][i];
      const name = `[Demo] Enquiry ${label}`;
      const lead = await rpc("create_manual_lead", { p_full_name: name, p_phone: `9${String(now + 100 + i).slice(-9)}`,
        p_email: null, p_city: "Bengaluru", p_procedure_interest: "Demo aesthetic consultation",
        p_message: "Fictional enquiry for staff practice", p_assign_to: sales.id, p_idempotency_key: randomUUID() });
      const id = lead.create_manual_lead;
      if (i === 1 || i === 2) await rpc("update_lead_status", { p_lead_id: id, p_status: label.toLowerCase(),
        p_note: "Demo follow-up call", p_next_follow_up_at: new Date(now - 60_000).toISOString(), p_lost_reason: null });
      if (i >= 3) {
        await rpc("convert_lead", { p_lead_id: id, p_appointment_at: new Date(now + 30 * 60_000).toISOString(),
          p_patient_id: null, p_patient_name: name, p_gender: "unknown", p_note: "Demo appointment" });
        if (i === 4) {
          const booked = (await db.query("select patient_id from leads where id=$1", [id])).rows[0];
          await visit(booked.patient_id);
        }
      }
    }
    // Source-table verification is read-only; staff writes above use normal permissions.
    await db.query("reset role");
    const stock = (await db.query("select quantity from medicine_batches where id=$1", [batch.id])).rows[0].quantity;
    assert.equal(stock, 94, "100 opening units minus 6 actually dispensed");
    const totals = (await db.query(`select
      (select sum(fee_paise)::int from visits where notes=$1) fees,
      (select sum(p.amount_paise)::int from visit_payments p join visits v on v.id=p.visit_id where v.notes=$1) payments,
      (select sum(s.total_paise)::int from pharmacy_sales s join prescriptions p on p.id=s.prescription_id join visits v on v.id=p.visit_id where v.notes=$1) medicines`, [marker])).rows[0];
    assert.deepEqual(totals, { fees: 300000, payments: 150000, medicines: 3000 });
    await db.query("commit");
    console.log(JSON.stringify({ added: "Demo ready queue, pending and dispensed prescriptions, five lead statuses", openingUnits: 100, remainingUnits: stock, consultationFeesRupees: 3000, consultationCollectedRupees: 1500, consultationOutstandingRupees: 1500, pharmacyCollectedRupees: 30 }));
  }
} catch (error) {
  await db.query("rollback");
  throw error;
} finally { await db.end(); }
