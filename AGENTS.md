<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — Meenakshi Hospital Management System

## 0. Mission

Build a **production-ready, super-clean, very simple hospital management system** for **Meenakshi Hospital** by upgrading the workflow of the provided `Star_CRM_Meenakshi_Hospital.html`.

The existing prototype already demonstrates the desired simplicity:

- Dashboard
- Reception
- OP consultation
- Pharmacy
- Patients
- Reports
- Doctors/settings
- Doctor queue
- Patient history
- Token printing
- Prescription printing
- Pharmacy dispensing
- Stock tracking

Do **not** turn this into a huge enterprise HMS.

The final product should feel like the same application, but:

- real authentication
- real Supabase database
- real private file storage
- role-based access
- OP + Doctor + IP + Pharmacy
- clean patient history
- test/report follow-up
- offline payment tracking
- printable token
- professional A4 prescription
- IP ticket and final bill
- powerful but simple dashboards/analytics
- fast tables
- mobile responsive
- production-safe

Primary implementation model: **GPT-5.6 Sol High** or equivalent.

---

# 1. ABSOLUTE NON-NEGOTIABLE RULES

## 1.1 shadcn/ui ONLY

The entire application UI must use **shadcn/ui components only**.

Allowed:

- shadcn/ui
- Tailwind CSS required by shadcn
- Lucide icons
- TanStack Table under the shadcn Data Table pattern
- TanStack Virtual only for large table/list virtualization
- Recharts only through shadcn chart patterns
- React Hook Form + Zod for forms

Forbidden:

- Material UI
- Ant Design
- Chakra
- Mantine
- Bootstrap component libraries
- PrimeReact
- custom third-party dashboard kits
- another component system mixed with shadcn

If shadcn has a suitable component, **use it instead of creating a custom replacement**.

Use:

```text
Sidebar
Button
Card
Input
Label
Textarea
Select
Combobox
Command
Popover
Dialog
AlertDialog
Sheet
Drawer
Tabs
Table
Badge
DropdownMenu
Tooltip
Separator
Breadcrumb
Form
Checkbox
RadioGroup
Switch
Calendar
Skeleton
Alert
Progress
ScrollArea
Pagination
Avatar
Chart
Sonner
```

Dedicated print templates are allowed to use semantic HTML/CSS because they are documents, not interactive UI.

---

## 1.2 Use shadcn root theme variables

Do not hard-code teal/blue/gray values all over the product.

Use semantic tokens:

```text
background
foreground
card
card-foreground
primary
primary-foreground
secondary
secondary-foreground
muted
muted-foreground
accent
accent-foreground
destructive
border
input
ring
sidebar
sidebar-foreground
sidebar-primary
sidebar-accent
```

Suggested modern Meenakshi Hospital theme:

```css
:root {
  --radius: 0.625rem;

  --background: oklch(0.985 0.004 180);
  --foreground: oklch(0.2 0.018 195);

  --card: oklch(1 0 0);
  --card-foreground: oklch(0.2 0.018 195);

  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.2 0.018 195);

  --primary: oklch(0.43 0.1 190);
  --primary-foreground: oklch(0.99 0 0);

  --secondary: oklch(0.955 0.012 185);
  --secondary-foreground: oklch(0.28 0.035 190);

  --muted: oklch(0.965 0.006 190);
  --muted-foreground: oklch(0.5 0.018 195);

  --accent: oklch(0.94 0.025 185);
  --accent-foreground: oklch(0.3 0.055 190);

  --destructive: oklch(0.58 0.22 27);
  --destructive-foreground: oklch(0.99 0 0);

  --border: oklch(0.91 0.008 190);
  --input: oklch(0.91 0.008 190);
  --ring: oklch(0.55 0.1 190);

  --chart-1: oklch(0.49 0.1 190);
  --chart-2: oklch(0.61 0.11 165);
  --chart-3: oklch(0.66 0.13 75);
  --chart-4: oklch(0.59 0.16 35);
  --chart-5: oklch(0.52 0.12 245);

  --sidebar: oklch(0.22 0.038 195);
  --sidebar-foreground: oklch(0.94 0.01 190);
  --sidebar-primary: oklch(0.6 0.12 185);
  --sidebar-primary-foreground: oklch(0.99 0 0);
  --sidebar-accent: oklch(0.29 0.04 195);
  --sidebar-accent-foreground: oklch(0.98 0 0);
  --sidebar-border: oklch(0.31 0.03 195);
  --sidebar-ring: oklch(0.6 0.12 185);
}
```

Small contrast adjustments are acceptable if accessibility requires them.

---

# 2. DESIGN DIRECTION

Use the official shadcn dashboard/sidebar style as the visual base.

The UI must be:

```text
Clean
White / neutral
Modern medical teal
Compact
Fast
Minimal
Professional
Readable
Table-first
No clutter
```

Do not use:

- huge hero sections
- excessive gradients
- decorative glassmorphism
- giant rounded cards
- unnecessary animations
- excessive colored boxes
- oversized typography
- marketing-style layouts inside operational pages

Use compact data-density suitable for hospital staff.

Desktop:

```text
┌────────────────┬──────────────────────────────────────────────┐
│ Sidebar        │ Header                                       │
│                ├──────────────────────────────────────────────┤
│                │ KPI cards                                    │
│                ├──────────────────────────────────────────────┤
│                │ Main table / workflow                        │
│                │                                              │
└────────────────┴──────────────────────────────────────────────┘
```

All operational list pages should primarily use **table views**.

---

# 3. MOBILE RESPONSIVENESS

The entire system must work on:

- desktop
- laptop
- tablet
- mobile

Do not finish desktop and leave mobile broken.

Mobile rules:

- shadcn responsive Sidebar/Sheet
- no viewport overflow
- tables use horizontal scrolling when necessary
- important row actions remain reachable
- dialogs fit viewport
- large dialogs become Drawer/Sheet where better
- consultation form fields stack
- prescription line table remains editable
- token print and prescription print actions remain visible
- dashboard cards reduce to 1–2 columns
- filters collapse into Sheet/Popover
- sticky action footer allowed on long mobile forms

Minimum manual QA widths:

```text
375px
430px
768px
1024px
1440px
```

---

# 4. AUTHENTICATION

Use **Supabase Auth email + password**.

Login:

```text
Meenakshi Hospital

Email
Password

[ Sign In ]
```

No public signup.

No social login required.

Admin creates users.

Server-only admin account creation must use the Supabase service role.

Never expose:

```text
SUPABASE_SERVICE_ROLE_KEY
```

to browser code.

---

# 5. FINAL ROLES

Exact V1 roles:

```text
admin
reception
op
doctor
ip
pharmacy
```

Admin has full access.

Every non-admin role sees only its own pages and permitted patient information.

This must be enforced in:

1. Sidebar/navigation
2. Next.js route protection
3. server actions / route handlers
4. Supabase RLS
5. automated authorization tests

Hiding a button is **not security**.

---

# 6. ROLE NAVIGATION

## 6.1 Admin

```text
Dashboard
Patients
Reception
OP
Doctors
IP
Pharmacy
Reports

Administration
  Users
  Doctors
  Departments
  Charges
  Clinical Directory
  Medicine Directory
  Report Categories
  Monthly Export
  Settings

Audit Logs
```

## 6.2 Reception

```text
Dashboard
Patients
Today's Visits
Follow-ups
Reports Ready
Payments
```

## 6.3 OP Staff

```text
Dashboard
Today's Queue
Vitals
Reports
```

## 6.4 Doctor

```text
Dashboard
My Queue
My Follow-ups
My IP Patients
Patient Search
```

## 6.5 IP Staff

```text
Dashboard
Admissions
Current Patients
IP Tickets
Discharges
```

## 6.6 Pharmacy

```text
Dashboard
Pending Prescriptions
Medicines
Stock
Bulk Import
Sales
```

---

# 7. DASHBOARDS — ROLE SPECIFIC

Every role gets a useful dashboard.

Do not show irrelevant analytics.

Admin gets the complete hospital dashboard.

---

## 7.1 Admin Dashboard

Top KPI cards:

```text
Patients Today
OP Visits Today
Waiting
In Consultation
Completed
Current IP Patients
Admissions Today
Discharges Today
Total Collected Today
OP Collection
IP Collection
Pharmacy Collection
Outstanding Balance
Low Stock
Expiring Medicines
Reports Pending
Reports Ready
```

Keep first row to 4–6 most useful cards. Put additional metrics below to avoid clutter.

Charts:

```text
Patient Visits — last 7/30 days
Collections — OP vs IP vs Pharmacy
Visits by Doctor
Visit Status
IP Admissions / Discharges
Pharmacy Sales trend
Top Dispensed Medicines
```

Tables:

### Live Doctor Queue

| Doctor | Waiting | In Consult | Completed | Total |
| ------ | ------: | ---------: | --------: | ----: |

### Recent Visits

| Token | Patient | Doctor | Type | Status | Time |
| ----: | ------- | ------ | ---- | ------ | ---- |

### Current IP

| Patient | Doctor | Room/Bed | Admitted | Running Total | Balance |
| ------- | ------ | -------- | -------- | ------------: | ------: |

### Alerts

| Alert | Item | Status | Action |
| ----- | ---- | ------ | ------ |

Admin can click KPI/chart/table rows to open filtered module views.

---

## 7.2 Reception Dashboard

Cards:

```text
Today's Registrations
Today's Visits
Waiting
Follow-ups Due
Reports Ready
Collected Today
Pending Balance
```

Main tables:

### Today's Visits

| Token | Patient | Phone | Doctor | Type | Collected | Status | Action |
| ----: | ------- | ----- | ------ | ---- | --------: | ------ | ------ |

### Follow-ups

| Patient | Phone | Doctor | Due/Trigger | Reason | Action |
| ------- | ----- | ------ | ----------- | ------ | ------ |

### Reports Ready

| Patient | Report | Doctor | Related Visit | Action |
| ------- | ------ | ------ | ------------- | ------ |

Reception actions:

```text
Open Patient
Create Visit
Print Token
Add Payment
Create Follow-up
```

---

## 7.3 OP Dashboard

Cards:

```text
Waiting
Vitals Pending
Ready for Doctor
Completed Today
Reports Pending
```

Main table:

| Token | Patient | Age/Gender | Doctor | Vitals | Status | Waiting | Action |
| ----: | ------- | ---------- | ------ | ------ | ------ | ------- | ------ |

Actions:

```text
Open
Record Vitals
Upload Report
Mark Ready
```

OP must not see financial information.

---

## 7.4 Doctor Dashboard

Cards:

```text
Waiting for Me
Ready for Me
Completed Today
Follow-ups Today
Reports Ready for Review
My IP Patients
```

Main queue table:

| Token | Patient | Age/Gender | Visit Type | Waiting | Vitals | Status | Action |
| ----: | ------- | ---------- | ---------- | ------- | ------ | ------ | ------ |

Follow-up table:

| Patient | Previous Visit | Reason | New Reports | Status | Action |
| ------- | -------------- | ------ | ----------: | ------ | ------ |

My IP Patients table:

| Patient | Room/Bed | Admission Date | Latest Note | Status | Action |
| ------- | -------- | -------------- | ----------- | ------ | ------ |

Doctor must not see hospital revenue/payment analytics.

---

## 7.5 IP Dashboard

Cards:

```text
Currently Admitted
Admissions Today
Discharges Today
Beds/Rooms In Use
Running IP Balance
Pending Discharge
```

Current patients table:

| IP Ticket | Patient | Doctor | Room/Bed | Admitted | Total | Paid | Balance | Status |
| --------- | ------- | ------ | -------- | -------- | ----: | ---: | ------: | ------ |

Admissions queue:

| Patient | Referred By | Admission Reason | Action |
| ------- | ----------- | ---------------- | ------ |

---

## 7.6 Pharmacy Dashboard

Cards:

```text
Pending Prescriptions
Today's Sales
Low Stock
Out of Stock
Expiring Soon
Dispensed Today
```

Tables:

### Pending Prescriptions

| Patient | Source | Doctor | Items | Time | Action |
| ------- | ------ | ------ | ----: | ---- | ------ |

### Stock Alerts

| Medicine | Batch | Expiry | Stock | Reorder Level | Status |
| -------- | ----- | ------ | ----: | ------------: | ------ |

### Recent Sales

| Time | Patient | Source | Amount | Items | Action |
| ---- | ------- | ------ | -----: | ----: | ------ |

---

# 8. ADMIN — USERS

Admin → Users.

Primary page must be a shadcn Data Table.

Columns:

| Name | Email | Role | Linked Doctor | Status | Last Sign-in | Actions |
| ---- | ----- | ---- | ------------- | ------ | ------------ | ------- |

Actions:

```text
Add User
Edit
Activate
Deactivate
Reset Password workflow
```

Add User dialog:

```text
Name
Email
Temporary Password
Role
Status
```

Admin can create:

```text
Reception
OP
Doctor
IP
Pharmacy
Admin
```

Doctor creation should normally use the Doctor workflow so credentials and doctor profile are linked correctly.

No hard delete of staff who have historical actions. Deactivate them.

---

# 9. ADMIN — DOCTORS

Doctors page: table view.

| Doctor | Department | Specialization | OP Fee | Follow-up Fee | IP Visit Fee | Status | Actions |
| ------ | ---------- | -------------- | -----: | ------------: | -----------: | ------ | ------- |

`+ Add Doctor` dialog:

```text
Name
Email
Temporary Password
Department
Specialization
Qualification
Registration Number
OP Consultation Fee
Follow-up Fee
Default IP Visit Fee
Status
```

Creating a doctor must:

```text
Create Supabase Auth account
      ↓
Create profile role=doctor
      ↓
Create doctor record
      ↓
Link auth profile ↔ doctor
      ↓
Create audit log
```

Do not leave partial records silently if one step fails.

---

# 10. PATIENT — MAIN DATA MODEL

Phone is the main **visible Patient ID**.

Example:

```text
Rajesh Kumar
Patient ID: 9876543210
```

Internally use:

```text
patients.id = UUID
```

All foreign keys reference UUID.

Patient fields:

```text
id UUID
phone_normalized TEXT UNIQUE
name
dob nullable
gender
address nullable
blood_group nullable
allergies nullable
notes nullable
status
created_at
updated_at
created_by
```

Normalize Indian V1 phone numbers to final 10 digits.

Do not use phone as the SQL primary key.

This allows a phone correction/change without destroying history.

---

# 11. PATIENT SEARCH

Search must be extremely fast.

Search by:

```text
Phone
Name
```

Rules:

- 200–250 ms debounce
- cancel stale requests
- max 10–20 autocomplete suggestions
- phone match ranks above name match for numeric queries
- do not download all patients
- server-side query
- indexed `phone_normalized`
- indexed searchable normalized name
- use prefix search first
- optional pg_trgm/fuzzy search only if needed and measured
- keyboard navigation using shadcn Command/Combobox
- enter opens selected patient

Patient list itself must use server-side pagination.

---

# 12. PATIENT DIRECTORY TABLE

Replace the prototype patient card grid with a compact table for desktop.

| Patient | Phone ID | Age/Gender | Visits | Last Visit | Last Doctor | Status | Action |
| ------- | -------- | ---------- | -----: | ---------- | ----------- | ------ | ------ |

Top toolbar:

```text
Search
Status filter
Last visit date filter
[ Add Patient ]
```

Mobile may render each row as a compact responsive card, but it must remain the same data/action model.

---

# 13. PATIENT PROFILE — CENTRAL SCREEN

This is the heart of the application.

Header:

```text
Rajesh Kumar
Patient ID: 9876543210
32 years • Male
Blood Group O+

[ Edit Patient ] [ + Create Visit ]
```

Tabs:

```text
Visits
IP Admissions
Reports
Payments
```

Do not bury visit history inside a small modal.

Use a proper patient route:

```text
/patients/[patientId]
```

where the URL may use an internal safe identifier, but the UI always shows phone as Patient ID.

---

# 14. VISIT HISTORY

One patient → many visits.

Visit types:

```text
OP
Follow-up
```

Patient → Visits table:

| Date | Token | Doctor | Type | Diagnosis | Fee | Collected | Balance | Status | Action |
| ---- | ----: | ------ | ---- | --------- | --: | --------: | ------: | ------ | ------ |

Financial columns:

- visible to Admin and Reception
- not visible to Doctor/OP unless explicitly needed

Action:

```text
View Visit
Print Prescription
Print Token (where relevant)
```

A completed visit is immutable as historical medical record except controlled amendment flows.

---

# 15. CREATE VISIT

Patient profile → `+ Create Visit`.

Use shadcn `Dialog`.

Fields:

```text
Patient — read only
Visit Type
Doctor
Department — auto-filled
Consultation Fee — derived from doctor
Amount Collected Offline
Payment Mode
Related Previous Visit — only for follow-up
Notes optional
```

Payment modes:

```text
Cash
UPI
Card
Bank Transfer
Other
```

On create:

```text
Create visit
  ↓
Create first payment entry if amount > 0
  ↓
Atomically generate doctor token
  ↓
Set status waiting
  ↓
Audit
  ↓
Show token confirmation
```

The visit/token creation must be concurrency-safe.

Do not generate token number by simply counting rows in browser memory.

Use a DB transaction/RPC/locking strategy so two reception users cannot receive the same token.

---

# 16. TOKEN PRINT

After visit creation:

```text
Visit created
Token #12

[ Print Token ]
[ Open Visit ]
[ Close ]
```

## Token MUST NOT display money

Do not show:

- consultation fee
- collected amount
- balance
- payment mode

Token print:

```text
MEENAKSHI HOSPITAL

TOKEN NO
12

Patient
Rajesh Kumar

Patient ID
9876543210

Doctor
Dr Kumar

Department
General Medicine

Date
11 Aug 2026

Time
10:35 AM
```

Optional:

```text
Please wait until your token is called.
```

Support:

- normal browser print
- compact thermal-style layout
- clean monochrome-safe output

Never mix payment receipt information into the token.

---

# 17. OFFLINE PAYMENT TRACKING

Payments are recorded, not processed online.

No gateway in V1.

Every payment is its own row.

Example:

```text
Visit Fee      ₹500
Collected      ₹300
Balance        ₹200
```

Later:

```text
+ Add Payment

₹200
UPI
```

Payment history:

| Date/Time | Amount | Mode | Collected By |
| --------- | -----: | ---- | ------------ |

Never overwrite payment #1 when payment #2 arrives.

Derived:

```text
total_due
total_collected
balance
payment_status
```

Statuses:

```text
Unpaid
Partially Paid
Paid
Refunded / Adjusted if later implemented
```

---

# 18. OP WORKFLOW

Flow:

```text
Visit Created
  ↓
OP Queue
  ↓
Record Vitals
  ↓
Mark Ready for Doctor
```

Vitals:

```text
Weight
Height
Temperature
BP systolic
BP diastolic
Pulse
SpO2
Respiratory rate optional
Notes optional
```

Use a compact shadcn form.

OP queue table:

| Token | Patient | Doctor | Vitals | Status | Waiting | Action |
| ----: | ------- | ------ | ------ | ------ | ------- | ------ |

---

# 19. DOCTOR CONSULTATION PAGE

Doctor must get a very fast working screen.

Desktop layout:

```text
┌────────────────┬────────────────────────────────────┐
│ My Queue       │ Current Patient                    │
│                │                                    │
│ Token 12       │ Patient header                     │
│ Token 13       │ Vitals                             │
│ Token 14       │ Clinical form                      │
│                │ Prescription                       │
└────────────────┴────────────────────────────────────┘
```

Do not make a cluttered three-column UI if it harms usable width.

Patient history should be available using shadcn Tabs/Sheet/Collapsible sections.

Doctor sees:

```text
Patient
Phone ID
Age/Gender
Vitals
Allergies
Previous visits
Previous diagnoses
Previous prescriptions
Reports
IP history when relevant
```

Clinical sections:

```text
Symptoms / Chief Complaint
History / Notes
Examination
Assessment / Diagnosis
Tests
Medicines
Advice
Follow-up
```

---

# 20. LOCAL CLINICAL DIRECTORY / AUTOCOMPLETE

Doctors should **not need to manually type every medical phrase from scratch**.

Build a local searchable clinical directory stored in Supabase/Postgres.

No dependency on a remote API during consultation.

The system should support a large local dictionary/catalog that can grow to hundreds of thousands or more entries if needed.

Never load the entire directory into the browser.

## Directory types

```text
Symptoms
Diagnoses
Investigations / Tests
Medicines
Generic Medicine Names
Dosage Forms
Routes
Frequency Presets
Duration Presets
Advice Templates
Specialties
```

Example doctor behavior:

Doctor types:

```text
vir
```

Suggestions:

```text
Viral illness
Viral fever
Viral upper respiratory infection
...
```

Doctor types medicine:

```text
parac
```

Suggestions:

```text
Paracetamol 500 mg Tablet
Paracetamol 250 mg/5 ml Syrup
...
```

The doctor selects a suggestion instead of typing everything.

## Data source rule

If master clinical/medicine datasets are imported:

- only use data that is legally usable
- record source
- record license
- record imported version/date
- do not scrape or redistribute proprietary medical datasets
- do not silently download unknown datasets
- keep import tooling separate from runtime

Create import scripts that accept normalized CSV/JSON.

## Search architecture

Use Postgres local search first.

Tables should include normalized search columns.

Use:

- exact match
- prefix match
- indexed normalized text
- optional trigram similarity when justified

Return max 15–25 suggestions.

Debounce doctor autocomplete around 150–250 ms.

No LLM call is required for basic autocomplete.

The system must remain usable even if external internet is unavailable after the app/data itself is available.

---

# 21. CLINICAL DIRECTORY ADMIN PAGE

Admin → Clinical Directory.

Use table view:

| Type | Display Text | Search Aliases | Active | Source | Action |
| ---- | ------------ | -------------- | ------ | ------ | ------ |

Actions:

```text
Add
Edit
Deactivate
Bulk Import CSV
Export
```

Filters:

```text
Type
Active
Source
```

This lets hospital staff add common local terms without editing code.

---

# 22. PRESCRIPTION ENTRY — TABLE FIRST

Prescription must use a table-style editor.

Do not create one giant free-text prescription field.

Desktop:

| Medicine | Dose | Frequency | Duration | Route | Notes | Qty |     |
| -------- | ---- | --------- | -------- | ----- | ----- | --: | --- |

`+ Add Medicine`

Medicine field uses searchable Combobox/Command suggestions.

When selected, show presets.

## Frequency presets

Support common patterns including:

```text
1-0-0
0-1-0
0-0-1
1-0-1
1-1-0
0-1-1
1-1-1
SOS
Once daily
Twice daily
Three times daily
Every 6 hours
Every 8 hours
Every 12 hours
Custom
```

Do not interpret these clinically on behalf of the doctor.

They are entry presets only.

## Duration presets

```text
1 day
2 days
3 days
5 days
7 days
10 days
14 days
30 days
SOS
Custom
```

## Route presets

```text
Oral
Topical
Nasal
Inhalation
Rectal
IV
IM
SC
Other
```

## Dose

Free/structured text:

```text
1 tablet
5 ml
3.5 ml
0.75 unit
etc.
```

## Notes presets

Examples:

```text
After food
Before food
At bedtime
If fever
If needed
Custom
```

Doctor can always override any preset.

---

# 23. DOCTOR DRAFT / COMPLETE

Buttons:

```text
[ Save Draft ]
[ Print Preview ]
[ Complete Consultation ]
```

After complete:

```text
[ View Prescription ]
[ Print Prescription ]
```

Completed consultation should not disappear from history.

---

# 24. PRESCRIPTION PRINT — CLOUDNINE-LIKE STRUCTURE

Use the supplied PDF as a **structural reference**, not a branding copy.

The reference has:

- doctor name/qualification/registration at top
- logo at opposite side
- patient identity
- consultation date
- weight/temperature strip
- structured history/symptoms
- examination/objectives
- assessment
- tests/advice table
- medicine table with dose/timing/duration/route/notes
- notes
- doctor/footer information
- page numbering

Create the Meenakshi version in A4.

## Header

Left:

```text
Dr Kumar
MBBS, MD
General Medicine
Registration: KMC-XXXXX
```

Right:

```text
Meenakshi Hospital
Hospital logo
```

Horizontal primary-color divider.

## Patient section

```text
Name
Age / Gender
Patient ID (phone)
Consultation Date
Weight
Temperature
BP when available
```

## Clinical sections

Render only sections containing data:

```text
Symptoms
History
Examination
Assessment
Advice / Investigations
```

## Investigations table

| Test | Date | Notes | Follow-up |
| ---- | ---- | ----- | --------- |

## Medicines table

| Name | Dose | Timing | Duration | Route | Notes |
| ---- | ---- | ------ | -------- | ----- | ----- |

Do not print stock quantity or pharmacy price.

## Footer

```text
Doctor name
Qualification
Registration number
Hospital address/contact from settings
Digital prescription statement configured by hospital
Page X/Y
```

Avoid giant blank areas when content fits on one page.

Use print-safe page break rules.

If content spans pages, repeat medicine header where practical.

---

# 25. TEST ORDERS

Doctor can add tests from the local directory.

Test order table:

| Test | Status | Ordered On | Report | Action |
| ---- | ------ | ---------- | ------ | ------ |

Statuses:

```text
Ordered
Report Pending
Report Ready
Reviewed
Cancelled
```

Doctor may set:

```text
Follow-up required
After report
Specific date
Specific number of days
No follow-up
```

---

# 26. REPORT UPLOAD

Reception/OP can upload report files where permitted.

Fields:

```text
Patient
Related Visit
Report Name
Category
Test Order optional
Report Date
File
Notes optional
```

Supported V1 file types:

```text
PDF
JPG
JPEG
PNG
WEBP
```

Categories:

```text
Lab Report
X-Ray / Radiology
Scan
Prescription
Clinical Photo
Discharge Summary
IP Document
Other
```

Storage:

```text
patient-documents/
  patient_uuid/
    uuid.ext
```

Do not use patient name as the object key.

Metadata belongs in PostgreSQL.

Bucket must be private.

Use signed/authenticated access.

---

# 27. REPORT FOLLOW-UP FLOW

Flow:

```text
Visit 1
  ↓
Doctor orders CBC
  ↓
Doctor marks Follow-up = After Report
  ↓
Consultation completed
  ↓
Report uploaded
  ↓
Report status = Ready
  ↓
Reception dashboard shows alert
  ↓
Create Follow-up Visit
  ↓
Same patient
  ↓
Same doctor by default
  ↓
Link Visit 2 → Visit 1
  ↓
Doctor reviews report
```

Never reopen Visit 1 as the follow-up.

Doctor follow-up page must show:

```text
Previous consultation summary
Previous diagnosis
Reason for follow-up
New reports
Previous prescription
```

---

# 28. PHARMACY — MEDICINE DIRECTORY VS STOCK

Separate:

1. **Medicine Directory**
2. **Actual Hospital Stock**

This is important.

The doctor may search a broader medicine directory.

The pharmacy manages what the hospital actually stocks.

## Medicine directory

Fields:

```text
id
brand_name
generic_name
strength
dosage_form
manufacturer optional
search_text
active
source
```

## Stock/batch

Fields:

```text
medicine_id
batch_number
expiry_date
quantity
purchase_price optional
selling_price
low_stock_threshold
active
```

The same medicine can have multiple batches.

---

# 28A. DOCTOR STOCK VISIBILITY — IMPORTANT

The doctor should be able to see **current pharmacy availability while selecting a medicine**, but prescribing must **never reduce stock**.

In the medicine autocomplete show a compact status:

```text
Paracetamol 500 mg Tablet
In stock: 124

Amoxicillin 500 mg Capsule
Low stock: 8

Cefixime 200 mg Tablet
Out of stock
```

Rules:

```text
Doctor selects/prescribes medicine
        ↓
Prescription saved
        ↓
Stock DOES NOT change
        ↓
Prescription appears in Pharmacy
        ↓
Pharmacy actually dispenses
        ↓
ONLY THEN stock reduces
```

If Pharmacy never dispenses the prescription:

```text
Stock remains exactly unchanged.
```

If Pharmacy partially dispenses:

```text
Requested: 10
Dispensed: 6

Only 6 units reduce from stock.
Remaining 4 stay pending/unavailable as applicable.
```

Doctor stock visibility is informational only because stock may change before the patient reaches Pharmacy.

Doctor must not see:

```text
Purchase price
Supplier cost
Internal margin
```

Doctor may see:

```text
Available
Low Stock
Out of Stock
Approximate available quantity
```

Do not block the doctor from prescribing an out-of-stock medicine unless the hospital explicitly configures that behavior later. Show a clear warning instead.

Prescription dispensing status:

```text
Pending
Partially Dispensed
Dispensed
```

Stock is never reserved in V1 merely because a prescription was created.

---

# 28B. PHARMACY STOCK REDUCTION — SOURCE OF TRUTH

The Pharmacy dispense action is the only normal V1 event that reduces medicine stock.

Use a database transaction/RPC:

```text
Open pending prescription
        ↓
Select actual quantity dispensed
        ↓
Select/auto-pick batch
        ↓
Validate available stock
        ↓
Create dispense/sale records
        ↓
Reduce exact batch quantity
        ↓
Commit transaction
```

Prefer **FEFO** (first-expiry-first-out) as the automatic batch suggestion, while allowing the pharmacist to choose another valid batch.

Must prevent:

```text
negative stock
double dispense on retry
double-click duplicate sale
duplicate IP pharmacy charge
```

Use transactional validation and idempotency/unique constraints where appropriate.

---

# 29. PHARMACY TABLE VIEWS

## Pending Prescriptions

| Patient | OP/IP | Doctor | Medicines | Requested | Status | Action |
| ------- | ----- | ------ | --------: | --------- | ------ | ------ |

## Medicines

| Medicine | Generic | Strength | Form | Available Qty | Status | Action |
| -------- | ------- | -------- | ---- | ------------: | ------ | ------ |

## Batches/Stock

| Medicine | Batch | Expiry | Qty | Selling Price | Alert | Action |
| -------- | ----- | ------ | --: | ------------: | ----- | ------ |

## Sales

| Date/Time | Patient | Source | Items | Total | Dispensed By | Action |
| --------- | ------- | ------ | ----: | ----: | ------------ | ------ |

---

# 30. PHARMACY STOCK ACTIONS

Pharmacy can:

```text
Add Medicine
Add Batch
Add Stock
Edit Stock Metadata
Deactivate Medicine
Dispense
View Sale
```

Do not hard-delete historical stock/sale references.

Low-stock and expiry status should be derived.

---

# 31. PHARMACY DISPENSING

Doctor completes prescription:

```text
Prescription
  ↓
Pharmacy Pending
  ↓
Open
  ↓
Select available batch(es)
  ↓
Dispense
  ↓
Stock reduces atomically
  ↓
Sale created
```

Prevent negative stock.

Use a DB transaction/RPC.

Handle concurrent dispensing safely.

Allow:

```text
Full dispense
Partial dispense
Unavailable item
```

Record actual quantity dispensed.

For OP:

- creates pharmacy sale/collection record.

For IP:

- pharmacy amount automatically adds to the IP ticket as a pharmacy charge.

---

# 31A. BULK MEDICINE IMPORT — EXCEL / CSV

Admin and Pharmacy can add medicines one by one, but the product must also support **fast bulk import of up to at least 1,000 medicine rows in one upload**.

Keep the UI extremely simple:

```text
Pharmacy
  ↓
Bulk Import

[ Download Excel Template ]

Drag & drop Excel/CSV here
or
[ Choose File ]
```

Supported:

```text
.xlsx
.csv
```

Do not require users to manually create column names.

The system generates the official template.

## Template columns

Use these V1 columns:

```text
medicine_name *
generic_name
strength
dosage_form *
manufacturer
batch_number *
expiry_date *
opening_quantity *
purchase_price
selling_price *
low_stock_threshold
active
```

Recommended spreadsheet headers exactly:

```text
medicine_name
generic_name
strength
dosage_form
manufacturer
batch_number
expiry_date
opening_quantity
purchase_price
selling_price
low_stock_threshold
active
```

Provide one example row in the template and a second `Instructions` worksheet if generating XLSX.

Example:

```text
Paracetamol 500mg
Paracetamol
500 mg
Tablet
ABC Pharma
PCM-2026-A
2027-08-31
500
1.20
2.00
50
TRUE
```

The template should explain:

```text
expiry_date = YYYY-MM-DD
quantity = whole number >= 0
prices = INR decimal values
active = TRUE/FALSE
required columns marked *
```

## Upload flow

```text
Download Template
      ↓
Fill rows in Excel
      ↓
Drag/drop or Choose File
      ↓
Parse
      ↓
Validate all rows
      ↓
Show Preview
      ↓
Confirm Import
      ↓
Batch upsert
      ↓
Show Result
```

Preview table:

| Row | Medicine | Batch | Expiry | Qty | Selling Price | Result |
| --: | -------- | ----- | ------ | --: | ------------: | ------ |

Summary:

```text
Rows in file: 1000
Valid: 982
Invalid: 18

[ Download Error Rows ]
[ Cancel ]
[ Import 982 Valid Rows ]
```

Do not silently import invalid rows.

## Duplicate handling

Use a clear deterministic identity.

Medicine directory match:

```text
normalized medicine name
+ generic/strength
+ dosage form
```

Batch match:

```text
medicine_id
+ batch_number
```

Default behavior:

```text
Existing medicine → reuse medicine record
Existing batch → update/merge stock only after explicit import confirmation
New batch → create batch
New medicine → create medicine + batch
```

Before import confirmation, show:

```text
New medicines
Existing medicines
New batches
Existing batches
Invalid rows
```

Do not create duplicate medicine entries merely because case/spacing differs.

## Performance

For 1,000 rows:

- parse once
- validate in memory/server efficiently
- do not issue 1,000 sequential browser-to-database requests
- send normalized rows to a server action/route
- process in safe batches, e.g. 100–250 rows
- use bulk insert/upsert/RPC
- wrap related medicine+batch changes safely
- return row-level errors
- show progress state
- keep UI responsive

No AI is required for this import.

## Permissions

```text
Admin     → allowed
Pharmacy  → allowed
Doctor    → not allowed
Reception → not allowed
OP        → not allowed
IP        → not allowed
```

Every bulk import creates an audit record including:

```text
actor
file name
row count
success count
error count
created medicines
updated batches
timestamp
```

---

# 31B. BULK IMPORT ACCEPTANCE TEST

A valid test file with 1,000 rows must:

```text
upload successfully
validate without freezing the browser
show preview
import in batches
avoid duplicate medicine records
create/update batches correctly
finish with accurate counts
leave invalid rows unimported
allow error rows to be downloaded
```

After import, doctor autocomplete must immediately be able to find the imported medicines, subject to normal cache invalidation/search indexing.

---

# 32. IP ADMISSION

Doctor can recommend IP from OP consultation.

Doctor records:

```text
Admission recommended
Reason
Diagnosis
Suggested ward optional
Instructions
```

IP staff sees the referral.

IP can also create a direct admission for an existing/new patient where permitted.

---

# 33. IP TICKET

Every IP admission has **one IP ticket**.

Example:

```text
IP-2026-000123

Patient
Rajesh Kumar
Patient ID 9876543210

Doctor
Dr Kumar

Room
203

Bed
B

Admission
11 Aug 2026
```

Status:

```text
Admitted
Discharge Pending
Discharged
Cancelled
```

---

# 34. IP CHARGES

All IP charges belong to the one ticket.

Charge categories:

```text
Doctor
Ward
Room
Bed
Treatment
Test
Pharmacy
Other
```

IP charge table:

| Date/Time | Category | Item | Qty | Rate | Amount | Added By |
| --------- | -------- | ---- | --: | ---: | -----: | -------- |

Running summary:

```text
Doctor       ₹1,500
Room         ₹4,500
Bed          ₹1,500
Treatment    ₹1,200
Tests        ₹1,000
Pharmacy     ₹2,300
Other          ₹500
-------------------
Total       ₹12,500
Collected    ₹5,000
Balance      ₹7,500
```

---

# 35. IP DOCTOR VISITS

Doctor opens `My IP Patients`.

Doctor can add progress notes.

Each doctor visit may optionally add the configured IP doctor charge.

Flow:

```text
Doctor opens IP patient
  ↓
Add Progress Note
  ↓
If chargeable visit:
create Doctor charge using configured amount
```

Do not allow duplicate charges caused by double-click/retry.

Use an idempotency key or transaction strategy.

---

# 36. IP TREATMENT / TEST / PHARMACY CHARGES

IP staff can add treatment charge:

```text
Nebulization
Dressing
Injection
Procedure
Other
```

Tests can create ticket charges.

Pharmacy dispense automatically creates the pharmacy ticket charge.

Every charge must retain:

```text
source_type
source_id
```

where applicable so it can be traced back and not duplicated.

---

# 37. IP PAYMENTS

Offline only.

`+ Add Payment`

Fields:

```text
Amount
Mode
Reference optional
Notes optional
```

Payment table:

| Date/Time | Amount | Mode | Reference | Collected By |
| --------- | -----: | ---- | --------- | ------------ |

Never overwrite previous payment rows.

---

# 38. IP DISCHARGE

Doctor:

```text
Final Diagnosis
Hospital Course
Treatment
Discharge Medicines
Advice
Follow-up
```

IP staff:

```text
Check total
Check collected
Check balance
Add final payment if needed
Complete discharge
```

Print:

```text
IP Ticket / Running Bill
Final IP Bill
Discharge Summary
```

---

# 39. PATIENT COMPLETE HISTORY

When a patient is opened, staff should be able to understand the whole history without searching different modules.

## Visits tab

| Date | Doctor | Type | Diagnosis | Status | Action |
| ---- | ------ | ---- | --------- | ------ | ------ |

## IP Admissions tab

| IP Ticket | Admission | Discharge | Doctor | Room/Bed | Status | Action |
| --------- | --------- | --------- | ------ | -------- | ------ | ------ |

## Reports tab

| Date | Report | Category | Related Visit/IP | Doctor | Status | Action |
| ---- | ------ | -------- | ---------------- | ------ | ------ | ------ |

## Payments tab

Only for roles allowed to see money.

| Date | Source | Amount | Mode | Collected By |
| ---- | ------ | -----: | ---- | ------------ |

Doctor should see clinical history, not unnecessary payment details.

---

# 40. ANALYTICS — MAXIMUM USEFUL, NOT CLUTTER

Provide comprehensive analytics, but organize them into tabs/filters.

Admin Reports tabs:

```text
Overview
OP
Doctors
IP
Pharmacy
Collections
Patients
```

Common date filter:

```text
Today
Yesterday
Last 7 Days
Last 30 Days
This Month
Custom Range
```

## Overview

```text
Total visits
Unique patients
New patients
Returning patients
OP collected
IP collected
Pharmacy collected
Total collected
Outstanding
Current IP count
```

## OP analytics

```text
Visits/day
Average waiting time
Completed vs cancelled
OP vs follow-up
Visits by hour
Visits by department
```

## Doctor analytics

```text
Patients seen
Completed consultations
Average waiting time
Follow-ups generated
Reports awaiting review
IP referrals
```

Do not rank doctors with medically misleading "performance scores".

## IP analytics

```text
Admissions
Discharges
Current census
Average stay
Charges by category
Outstanding balances
```

## Pharmacy analytics

```text
Sales trend
Items dispensed
Top medicines by quantity
Low stock
Out of stock
Expiring in 30/60/90 days
```

## Patient analytics

```text
New vs returning
Visit frequency
Follow-up completion
Report pending/ready counts
```

Use server-side aggregate queries/RPCs/views.

Do not fetch thousands of rows into the browser and aggregate them client-side.

---

# 41. TABLE UX STANDARD

All important modules use the same shadcn Data Table approach.

Required table capabilities where useful:

```text
Search
Column filters
Date filter
Status filter
Sorting
Server-side pagination
Page size 10 / 20 / 50
Row actions dropdown
Loading skeleton
Empty state
Error state
```

Do not add filters that do not help the role.

Use sticky table headers for long operational lists when useful.

Use URL search params for durable filters where practical.

Example:

```text
?status=waiting&page=2&pageSize=20&doctor=...
```

---

# 42. PAGINATION / VIRTUALIZATION / DEBOUNCE

## Server-side pagination

Required for:

```text
Patients
Visits history
Reports
Payments
Audit logs
Medicine directory
Medicine stock
Pharmacy sales
IP tickets
IP charges
Admin reports detail tables
```

Never query `select *` for an unbounded table.

## Virtualization

Use TanStack Virtual only when:

- a client-visible list genuinely contains many rows,
- virtualization materially improves rendering,
- server pagination alone is insufficient for that specific workflow.

Do not virtualize every 10-row table.

Candidates:

```text
very large local medicine autocomplete result window
large audit/result views
large master directory management
```

## Debounce

Use approximately:

```text
Patient search: 200–250 ms
Medicine search: 150–250 ms
Clinical directory: 150–250 ms
Admin list search: 250–300 ms
```

Cancel stale search requests.

---

# 43. DATABASE — KEEP CLEAN, NOT OVERCOMPLEX

Recommended core tables:

```text
profiles
doctors
departments

patients

visits
visit_payments
vitals
consultations

clinical_terms

medicine_directory
medicine_batches

test_orders
patient_reports

prescriptions
prescription_items

pharmacy_sales
pharmacy_sale_items

ip_tickets
ip_progress_notes
ip_charges
ip_payments

report_categories
hospital_settings

bulk_import_jobs
bulk_import_errors
export_jobs

audit_logs
```

Do not create dozens of tables without reason.

Use `jsonb` only when appropriate; important searchable relational fields should remain normal columns.

---

# 44. KEY RELATIONSHIPS

```text
patient
  ├── visits
  │    ├── payments
  │    ├── vitals
  │    ├── consultation
  │    ├── test orders
  │    ├── reports
  │    └── prescription
  │          └── prescription items
  │
  ├── IP tickets
  │    ├── progress notes
  │    ├── charges
  │    ├── payments
  │    └── reports
  │
  └── reports
```

---

# 45. DATABASE INDEXES

At minimum evaluate/create indexes for:

```text
patients(phone_normalized)
patients(name_normalized)

visits(patient_id, created_at desc)
visits(doctor_id, visit_date, status)
visits(doctor_id, visit_date, token_number)

visit_payments(visit_id, created_at)

clinical_terms(term_type, normalized_text)
medicine_directory(search_text)
medicine_batches(medicine_id, expiry_date)

test_orders(patient_id, status)
test_orders(doctor_id, status)

patient_reports(patient_id, created_at desc)
patient_reports(visit_id)
patient_reports(ip_ticket_id)

prescriptions(visit_id)
prescription_items(prescription_id)

pharmacy_sales(created_at)
pharmacy_sales(patient_id)

ip_tickets(patient_id, admission_at desc)
ip_tickets(doctor_id, status)
ip_charges(ip_ticket_id, created_at)
ip_payments(ip_ticket_id, created_at)

bulk_import_jobs(created_at desc)
export_jobs(export_month, created_at desc)

audit_logs(created_at desc)
audit_logs(actor_user_id, created_at desc)
```

Use indexes based on actual query patterns.

Do not create redundant indexes blindly.

---

# 46. RLS / SECURITY

Sensitive medical data requires server and DB enforcement.

Use RLS on all relevant tables.

High-level behavior:

## Admin

Full hospital access.

## Reception

Can:

```text
read/create/update basic patient demographics
create visits
read visit operational status
record offline payments
view follow-up/report-ready workflow
```

Cannot modify clinical diagnosis/prescription.

## OP

Can:

```text
read patients in OP workflow
record/update current visit vitals
upload permitted reports
update OP readiness statuses
```

Cannot see hospital financial analytics.

## Doctor

Can:

```text
read assigned/relevant clinical patients
read patient clinical history
write own visit consultations
create prescriptions
create test orders
create follow-up recommendation
manage own relevant IP progress notes
```

Cannot manage users or hospital finances.

## IP

Can:

```text
manage admissions
manage room/bed text fields
manage IP operational data
add configured charges/payments
upload IP reports
process discharge operations
```

Cannot edit doctor clinical notes.

## Pharmacy

Can:

```text
read prescriptions needed for dispensing
manage medicine stock
create dispensing/sales records
```

Clinical history access should be minimal.

---

# 47. AUDIT LOGS

Create audit events for important actions.

Examples:

```text
USER_CREATED
USER_DEACTIVATED
ROLE_CHANGED

DOCTOR_CREATED
DOCTOR_UPDATED

PATIENT_CREATED
PATIENT_UPDATED
PATIENT_ARCHIVED

VISIT_CREATED
TOKEN_GENERATED
PAYMENT_ADDED

VITALS_RECORDED

CONSULTATION_DRAFT_SAVED
CONSULTATION_COMPLETED
PRESCRIPTION_PRINTED

TEST_ORDERED
REPORT_UPLOADED
REPORT_VIEWED
REPORT_REVIEWED

PHARMACY_DISPENSED
STOCK_ADDED
STOCK_ADJUSTED

IP_ADMITTED
IP_CHARGE_ADDED
IP_PAYMENT_ADDED
IP_PROGRESS_NOTE_ADDED
IP_DISCHARGED

DOCUMENT_VIEWED

BULK_MEDICINE_IMPORT_STARTED
BULK_MEDICINE_IMPORT_COMPLETED
BULK_MEDICINE_IMPORT_FAILED

EXPORT_GENERATED
EXPORT_DOWNLOADED
EXPORT_DELETED
```

Do not log medical content unnecessarily into generic logs.

Log identifiers and action metadata, not entire sensitive payloads.

---

# 48. SUPABASE STORAGE

Use Supabase Storage V1.

Patient bucket:

```text
patient-documents
```

Must be private.

Object path:

```text
patient_uuid/category_uuid/object_uuid.ext
```

Database stores:

```text
display_name
original_filename
object_path
mime_type
size
category
patient_id
visit_id nullable
ip_ticket_id nullable
report_date
uploaded_by
created_at
```

Validate:

- allowed MIME type
- max file size
- role authorization
- patient relationship

Do not rely only on file extension.

---

# 49. PRINTING

Required print actions:

```text
Token
Prescription
Old Prescription reprint
IP running ticket
Final IP bill
Discharge summary
```

Print templates must:

- hide app navigation
- print correctly on A4 where applicable
- have predictable margins
- avoid chopped tables
- use black text with controlled primary accent
- print date/time correctly
- avoid browser-only buttons in output

Token may use compact paper dimensions.

Prescription and discharge are A4.

---

# 50. PRINT TOKEN CONTENT — FINAL

Exactly keep token simple.

```text
Meenakshi Hospital

Token No: 12

Patient:
Rajesh Kumar

Patient ID:
9876543210

Doctor:
Dr Kumar

Department:
General Medicine

Date:
11 Aug 2026

Time:
10:35 AM
```

Do not show any money/payment information.

---

# 51. ADMIN CHARGES MASTER

Admin → Charges.

Table:

| Category | Charge Name | Amount | Active | Action |
| -------- | ----------- | -----: | ------ | ------ |

Categories:

```text
OP
Follow-up
IP Doctor
Ward
Room
Bed
Treatment
Test
Other
```

Examples:

```text
OP Consultation      ₹500
Follow-up             ₹300
IP Doctor Visit       ₹500
General Ward / Day    ₹800
Private Room / Day  ₹1,500
Bed / Day             ₹500
Nebulization          ₹300
Dressing              ₹400
CBC                    ₹400
CRP                    ₹500
X-Ray                  ₹800
```

Doctor-specific fees override generic defaults where configured.

---

# 52. SETTINGS

Admin settings should remain simple.

Tabs:

```text
Hospital
Print
Clinical
Security
```

Hospital:

```text
Hospital Name
Logo
Address
Phone
Email
Default Department
```

Print:

```text
Prescription footer
Token footer
Digital prescription text
```

Clinical:

```text
default follow-up options
default duration presets
default frequency presets
```

Security:

```text
session/settings appropriate to implementation
```

Do not create dozens of configuration toggles.

---

# 52A. MONTHLY DATA EXPORT / DOWNLOAD

Admin needs a simple **Monthly Export** screen so the hospital can download its records periodically.

This is an export feature for hospital-owned data. It is **not a replacement for managed database backups**.

Admin navigation:

```text
Administration
  ↓
Monthly Export
```

UI:

```text
Monthly Data Export

Month
[ August 2026 ▼ ]

Export Type
(•) Data only
( ) Data + uploaded documents

[ Generate Export ]
```

After generation:

```text
August 2026
Ready

Generated: 11 Sep 2026, 09:30 AM
Generated by: Admin

[ Download ZIP ]
```

## Data included

The monthly export should include, for the selected month where relevant:

```text
patients
visits
visit payments
vitals
consultations
prescriptions
prescription items
test orders
report metadata
pharmacy sales
pharmacy sale items
medicine stock/batch snapshot
IP tickets
IP progress notes
IP charges
IP payments
discharges
staff/action audit metadata
hospital settings snapshot where useful
```

Patient master records referenced by monthly transactions should be included so the export can be understood without another database lookup.

## Export package

Generate a ZIP.

Recommended structure:

```text
meenakshi-hospital-2026-08.zip
│
├── manifest.json
├── patients.csv
├── visits.csv
├── visit_payments.csv
├── vitals.csv
├── consultations.csv
├── prescriptions.csv
├── prescription_items.csv
├── test_orders.csv
├── reports.csv
├── pharmacy_sales.csv
├── pharmacy_sale_items.csv
├── medicine_batches_snapshot.csv
├── ip_tickets.csv
├── ip_progress_notes.csv
├── ip_charges.csv
├── ip_payments.csv
├── audit_log.csv
│
└── documents/                 # only for "Data + uploaded documents"
    └── ...
```

CSV is preferred for large tabular data because it is simple and portable.

Optionally include an XLSX summary workbook for convenience, but do not make XLSX the only archival representation.

## `manifest.json`

Include:

```text
hospital
export_month
generated_at
generated_by
schema_version
app_version
record_counts
included_files
document_count
checksum metadata where practical
```

## Security

Only Admin may generate/download the complete hospital export.

Requirements:

```text
server-side generation
private export storage
short-lived signed download URL
audit EXPORT_GENERATED
audit EXPORT_DOWNLOADED
never place exports in public buckets
do not expose export URLs permanently
```

Exports contain sensitive patient data.

Do not email the ZIP automatically in V1.

## Retention

Keep generated exports only for a short configurable period, for example:

```text
7 days
```

Then remove the generated ZIP from temporary export storage.

The hospital may keep the file after downloading it.

## Large document exports

For `Data + uploaded documents`:

- stream/iterate files
- do not load the whole ZIP into browser memory
- generate on server
- show status:
  - Queued
  - Generating
  - Ready
  - Failed
- prevent duplicate simultaneous export jobs for the same month/user where practical

For a small V1 deployment, the export can be generated synchronously only if measured size is safe. Otherwise use a persisted export-job workflow.

---

# 52B. MONTHLY EXPORT TABLE

Admin page table:

| Month | Type | Generated At | Generated By | Size | Status | Action |
| ----- | ---- | ------------ | ------------ | ---: | ------ | ------ |

Actions:

```text
Generate
Download
Regenerate
Delete Generated ZIP
```

Deleting a generated ZIP does not delete hospital database records.

---

# 53. PERFORMANCE TARGETS

For roughly 20 active staff, the app should feel instant.

Targets under normal network conditions:

```text
Dashboard initial meaningful content: fast and streamed/skeleton where useful
Autocomplete response: usually <300 ms excluding network variance
Table page changes: quick, no full-page reload
Visit creation: one clear transaction
Doctor save: optimistic only where safe
```

Use:

- React Server Components where they simplify reads
- server actions or route handlers for mutations
- request caching only for safe/non-user-sensitive data
- no caching of private patient data across users incorrectly
- narrow selects instead of `select *`
- batch/aggregate DB operations
- Promise.all only where calls are truly independent
- avoid waterfall queries
- lazy-load heavy chart areas
- dynamic import non-critical heavy client widgets if needed

---

# 54. NEXT.JS STRUCTURE

Suggested:

```text
src/
├── app/
│   ├── (auth)/
│   │   └── login/
│   │
│   ├── (app)/
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   ├── patients/
│   │   │   ├── page.tsx
│   │   │   └── [id]/
│   │   ├── reception/
│   │   ├── op/
│   │   ├── doctor/
│   │   ├── ip/
│   │   ├── pharmacy/
│   │   ├── reports/
│   │   ├── admin/
│   │   │   ├── users/
│   │   │   ├── doctors/
│   │   │   ├── charges/
│   │   │   ├── clinical-directory/
│   │   │   ├── medicines/
│   │   │   └── settings/
│   │   └── audit/
│   │
│   └── print/
│       ├── token/
│       ├── prescription/
│       ├── ip-ticket/
│       ├── ip-bill/
│       └── discharge/
│
├── components/
│   ├── ui/                  # generated shadcn
│   ├── app-sidebar.tsx
│   ├── data-table/
│   └── ...
│
├── features/
│   ├── auth/
│   ├── patients/
│   ├── visits/
│   ├── clinical/
│   ├── reports/
│   ├── pharmacy/
│   ├── ip/
│   ├── payments/
│   └── analytics/
│
├── lib/
│   ├── supabase/
│   ├── auth/
│   ├── permissions/
│   ├── validation/
│   ├── pagination/
│   └── print/
│
└── types/
```

Use feature boundaries.

Do not create one giant 5,000-line page component.

---

# 55. SERVER / CLIENT COMPONENT RULES

Prefer Server Components for:

```text
page shells
initial table data
dashboard aggregates
patient history reads
report reads
admin lists
```

Use Client Components only for:

```text
interactive forms
dialogs
combobox/autocomplete
table sorting/filter controls where client state is needed
charts
prescription editor
print trigger
```

Do not mark the whole app `use client`.

---

# 56. FORMS / VALIDATION

Use:

```text
React Hook Form
Zod
shadcn Form
```

Validate both client-side UX and server-side authoritative input.

Normalize:

```text
phone
email
money
dates
enum values
```

Never trust browser-submitted role or ownership IDs.

---

# 57. MONEY

Store money using an exact numeric/integer strategy.

Preferred simple V1:

```text
amount_paise BIGINT
```

Examples:

```text
₹500.00 → 50000
₹300.00 → 30000
```

Format to INR in UI.

Do not store financial amounts as JS floating-point database values.

---

# 58. DATE/TIME

Store timestamps in UTC.

Display in hospital timezone.

For date-only fields use date columns.

Do not generate today's operational queue using incorrect UTC date boundaries.

Centralize timezone logic.

---

# 59. CONCURRENCY / DATA INTEGRITY

Must handle:

## Token race

Two Reception users create visits at the same time.

Result:

```text
Token 12
Token 13
```

Never both Token 12.

## Pharmacy race

Two pharmacists dispense same stock.

Stock must never become negative.

## Payment double submit

Double click must not create duplicate payment.

## IP charge double submit

Retry must not duplicate charge.

Use:

- DB transactions
- unique constraints
- idempotency keys where useful
- server-side validation

---

# 60. ERROR / LOADING UX

Every major page must have:

```text
Skeleton loading
Empty state
Inline validation
Error state
Retry action when useful
Sonner success/error feedback
Disabled submit while processing
```

Do not use `alert()`.

Do not swallow exceptions.

Do not display raw database errors to staff.

---

# 61. ANALYTICS QUERY DESIGN

Create dedicated aggregate queries/views/RPC where helpful.

Examples:

```text
dashboard_admin_today()
dashboard_reception_today()
dashboard_doctor_today(doctor_id)
dashboard_ip_today()
dashboard_pharmacy_today()
report_collections(date_from, date_to)
report_visits(date_from, date_to)
report_doctors(date_from, date_to)
report_ip(date_from, date_to)
report_pharmacy(date_from, date_to)
```

Ensure security context is respected.

Do not put one enormous all-purpose RPC around the whole application.

---

# 62. BASIC SQL CONSTRAINTS

Use constraints wherever possible.

Examples:

```text
phone_normalized unique
visit token unique per doctor/date
money >= 0
stock quantity >= 0
valid status enums/checks
payment amount > 0
IP discharge >= admission
```

Use foreign keys.

Use ON DELETE behavior carefully.

Do not cascade-delete patient clinical history accidentally.

---

# 63. NO HARD DELETE

Do not hard delete:

```text
Patients
Visits
Consultations
Prescriptions
Payments
Pharmacy Sales
IP Tickets
IP Charges
IP Payments
Reports
Doctor records with history
Staff profiles with history
```

Use:

```text
active
archived
cancelled
voided
```

where required.

If an incorrect financial entry needs correction, preserve original and create an adjustment/void event rather than silently overwriting history.

---

# 64. ACCESSIBLE UX

Use shadcn semantics correctly.

Required:

- proper labels
- keyboard navigation
- focus states
- dialog focus management
- sufficient contrast
- table row actions reachable by keyboard
- no color-only status meaning
- icon buttons with accessible labels/tooltips

---

# 65. ROLE PAGE TABLE SUMMARY

This is the final role/table UX reference.

| Role      | Main Page     | Primary Table                     |
| --------- | ------------- | --------------------------------- |
| Admin     | Dashboard     | Live doctor queue / recent visits |
| Admin     | Patients      | All patients                      |
| Admin     | Users         | Staff users                       |
| Admin     | Doctors       | Doctors + fee/status              |
| Admin     | Reports       | Detailed report tables            |
| Reception | Dashboard     | Today's visits                    |
| Reception | Patients      | Patient directory                 |
| Reception | Follow-ups    | Follow-up queue                   |
| Reception | Reports Ready | Reports needing new visit         |
| OP        | Dashboard     | Vitals queue                      |
| OP        | Reports       | Pending/ready reports             |
| Doctor    | Dashboard     | My queue                          |
| Doctor    | Follow-ups    | My follow-up patients             |
| Doctor    | IP            | My admitted patients              |
| IP        | Dashboard     | Current IP patients               |
| IP        | Tickets       | IP ticket list                    |
| IP        | Discharges    | Discharge queue                   |
| Pharmacy  | Dashboard     | Pending prescriptions             |
| Pharmacy  | Medicines     | Medicine master                   |
| Pharmacy  | Stock         | Batch/stock                       |
| Pharmacy  | Sales         | Pharmacy sales                    |

Admin may open all of the above.

Non-admin roles see only their allowed own pages.

---

# 66. SAMPLE END-TO-END OP FLOW

```text
1. Reception searches 9876543210.
2. Rajesh Kumar opens.
3. Reception clicks + Create Visit.
4. Select Dr Kumar.
5. OP fee auto-fills ₹500.
6. Reception records ₹500 collected offline.
7. Create.
8. Token #12 generated transactionally.
9. Reception prints token.
10. Token print contains NO amount/payment mode.
11. OP staff sees Token #12.
12. OP records vitals.
13. OP marks Ready.
14. Dr Kumar sees Token #12 in My Queue.
15. Doctor opens patient.
16. Doctor sees previous visit history.
17. Doctor types "vir" and selects a diagnosis suggestion.
18. Doctor types "parac" and selects a medicine.
19. Doctor chooses frequency 1-0-1.
20. Doctor chooses duration 3 days.
21. Doctor orders CBC.
22. Doctor marks Follow-up After Report.
23. Doctor completes consultation.
24. Doctor prints A4 prescription.
25. Pharmacy sees prescription.
26. Pharmacy dispenses available medicine.
27. Stock decreases transactionally.
28. CBC report is later uploaded.
29. Reception sees Report Ready.
30. Reception clicks Create Follow-up.
31. New Follow-up Visit is created and linked to Visit #1.
32. Doctor sees CBC when Visit #2 opens.
33. Old Visit #1 remains unchanged.
```

---

# 67. SAMPLE END-TO-END IP FLOW

```text
1. Doctor recommends admission.
2. IP receives referral.
3. IP opens same patient.
4. Create IP Ticket.
5. Select Dr Kumar.
6. Enter room/bed.
7. Record deposit offline.
8. IP ticket becomes Active.
9. Doctor visits patient and adds progress note.
10. Doctor visit charge is added once.
11. IP adds treatment charges when performed.
12. Doctor orders tests.
13. Test charge is added.
14. Pharmacy dispenses IP prescription.
15. Stock decreases.
16. Pharmacy charge automatically links to IP ticket.
17. IP ticket shows running total/paid/balance.
18. Doctor prepares discharge clinical summary.
19. IP records final payment.
20. Complete discharge.
21. Print final IP bill.
22. Print discharge summary.
23. Entire admission remains under patient history.
```

---

# 68. TESTING REQUIREMENTS

Do not declare the product complete without tests.

## Unit tests

Cover:

```text
phone normalization
currency conversion
role permission helpers
payment calculations
balance calculations
token formatting
follow-up status logic
stock calculations
IP totals
date/time helpers
```

## Integration tests

Cover:

```text
admin creates user
admin creates doctor
reception creates patient
reception creates visit
token uniqueness
payment persistence
OP vitals
doctor consultation
prescription items
test order
report upload metadata
follow-up link
pharmacy dispense
stock concurrency
IP ticket
IP charge
IP payment
discharge
RLS
```

## E2E tests

At minimum:

```text
Admin login
Reception OP flow
Doctor consultation flow
Report follow-up flow
Pharmacy flow
IP admission/discharge flow
Role access isolation
Token print route
Prescription print route
Mobile critical flow
```

---

# 69. ROLE SECURITY TEST MATRIX

Automated tests must verify:

| Attempt                   | Admin |              Reception |      OP |                 Doctor |         IP |                     Pharmacy |
| ------------------------- | ----: | ---------------------: | ------: | ---------------------: | ---------: | ---------------------------: |
| Manage users              |    ✅ |                     ❌ |      ❌ |                     ❌ |         ❌ |                           ❌ |
| Manage doctor fees        |    ✅ |                     ❌ |      ❌ |                     ❌ |         ❌ |                           ❌ |
| Create patient            |    ✅ |                     ✅ | Limited |             ❌/Limited |    Limited |                           ❌ |
| Create OP visit           |    ✅ |                     ✅ |      ❌ |                     ❌ |         ❌ |                           ❌ |
| Record vitals             |    ✅ |                   View |      ✅ |                     ✅ |      ✅ IP |                           ❌ |
| Write diagnosis           |    ✅ |                     ❌ |      ❌ |            ✅ own care |         ❌ |                           ❌ |
| Create prescription       |    ✅ |                     ❌ |      ❌ |            ✅ own care |         ❌ |                           ❌ |
| Dispense pharmacy         |    ✅ |                     ❌ |      ❌ |                     ❌ |         ❌ |                           ✅ |
| Create IP ticket          |    ✅ |                Limited |      ❌ |                  Refer |         ✅ |                           ❌ |
| Add IP operational charge |    ✅ |                     ❌ |      ❌ | doctor charge via note |         ✅ | pharmacy charge via dispense |
| View financial analytics  |    ✅ | limited own collection |      ❌ |                     ❌ | limited IP |             limited pharmacy |

Adjust precise RLS only when workflow requires it, but do not broaden permissions casually.

---

# 70. PRINT QA

Test:

```text
Chrome desktop print
A4 portrait
thermal/compact token
1-page prescription
2-page prescription
long medicine table
long notes
page breaks
page numbers
mobile print trigger
```

Prescription should visually follow the supplied reference structure.

Token should never reveal fee/payment information.

---

# 71. PERFORMANCE QA

Seed enough development data to test scale:

```text
10,000 patients
50,000 visits
100,000 payment/report/history rows where useful
large medicine/clinical directory sample
thousands of pharmacy stock/sale rows
thousands of IP charges
```

Verify:

- patient search does not load all records
- autocomplete remains fast
- table pagination is server-side
- dashboard queries are aggregates
- large lists do not freeze browser
- no obvious N+1
- no waterfall explosion
- mobile remains usable

Do not need millions of production rows to test locally, but architecture must not assume tiny arrays.

---

# 72. DATA SEED / IMPORT TOOLS

Create safe development seed scripts for:

```text
roles
admin user bootstrap instructions
departments
charge presets
report categories
frequency presets
duration presets
route presets
clinical directory sample
medicine directory sample
demo patients
```

Create bulk import tooling for:

```text
clinical terms CSV
medicine directory CSV
```

Do not commit real patient data.

Do not use the supplied prescription's personal data as seed data.

---

# 73. ENVIRONMENT VARIABLES

Document required variables in `.env.example`.

Example:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_TIMEZONE=Asia/Kolkata
```

Never commit secrets.

---

# 74. DOCUMENTATION REQUIRED

Before completion create/update:

```text
README.md
AGENTS.md
.env.example
SUPABASE_SETUP.md
DEPLOYMENT.md
PERMISSIONS.md
PRINTING.md
```

README must explain:

```text
install
run
test
build
database migration
Supabase setup
storage bucket
create first admin
deployment
```

---

# 75. MIGRATION FROM CURRENT HTML PROTOTYPE

Treat the provided HTML as a **workflow/UI reference**, not production architecture.

Preserve useful concepts:

```text
doctor-wise queue
patient search
patient visit history
status badges
token
prescription
pharmacy pending prescription
stock master
sales
dashboard
reports
doctor settings
```

Replace:

```text
local/in-memory storage
custom HTML buttons
custom selects
custom dialogs
custom tables where shadcn should be used
single giant application state
hard deletion
paid=true shortcut
client-generated race-prone token
```

with:

```text
Supabase
shadcn
server-side data access
RLS
normalized tables
transactions
real payment rows
server pagination
role isolation
```

---

# 76. IMPLEMENTATION ORDER

Follow this order so dependencies remain clear.

## Phase 1 — Foundation

```text
Next.js
shadcn
root theme
Supabase clients
Auth
profiles/roles
route guards
sidebar
mobile shell
```

Acceptance:

```text
email/password login
admin vs role navigation
mobile shell works
```

## Phase 2 — Admin masters

```text
Users
Doctors
Departments
Charges
Settings
Report categories
Clinical directory
Medicine directory
```

Acceptance:

```text
admin can create/activate/deactivate users
admin can create doctors with fees
tables/search/pagination work
```

## Phase 3 — Patients + visits

```text
Patient table
phone search
patient profile
create visit
offline payment
token
token print
```

Acceptance:

```text
one patient → many visits
phone visible Patient ID
token unique
token has no money
```

## Phase 4 — OP + Doctor

```text
OP queue
vitals
doctor queue
consultation
clinical autocomplete
prescription table
print prescription
```

Acceptance:

```text
doctor can type and select suggestions
1-0-1 etc supported
A4 prescription works
```

## Phase 5 — Tests/reports/follow-up

```text
test order
report upload
private storage
report ready
follow-up visit linking
```

Acceptance:

```text
report triggers follow-up workflow correctly
old visit unchanged
```

## Phase 6 — Pharmacy

```text
medicine stock
batches
doctor stock availability display
pending prescription
dispense
sales
bulk Excel/CSV import
downloadable import template
IP/OP source
```

Acceptance:

```text
stock atomic
no negative quantity
```

## Phase 7 — IP

```text
IP ticket
charges
payments
doctor notes
pharmacy charges
tests
discharge
print bill/summary
```

Acceptance:

```text
one ticket contains all charge categories
running total correct
```

## Phase 8 — Analytics + export + hardening

```text
role dashboards
admin analytics
monthly data export
export jobs/private downloads
pagination
virtualization where justified
audit
RLS audit
mobile QA
performance QA
print QA
deployment
```

---

# 77. FINAL ACCEPTANCE CHECKLIST

Do not stop until every applicable item is green.

## UI

- [ ] shadcn/ui only
- [ ] root semantic theme used
- [ ] modern clean dashboard
- [ ] compact table-first UX
- [ ] responsive 375 → 1440+
- [ ] no mixed UI library
- [ ] no giant decorative sections

## Auth

- [ ] email/password
- [ ] no public signup
- [ ] admin user creation server-only
- [ ] six roles
- [ ] role sidebar
- [ ] route authorization
- [ ] RLS authorization

## Patient

- [ ] phone visible Patient ID
- [ ] UUID internal
- [ ] fast debounced search
- [ ] patient table
- [ ] patient profile
- [ ] visit history
- [ ] IP history
- [ ] reports
- [ ] payments role-restricted

## Visit

- [ ] create visit Dialog
- [ ] doctor selection
- [ ] fee
- [ ] offline amount collected
- [ ] multiple payments
- [ ] token atomic
- [ ] token print
- [ ] token print NO MONEY

## Doctor

- [ ] own queue only
- [ ] patient clinical history
- [ ] vitals
- [ ] clinical autocomplete
- [ ] medicine autocomplete
- [ ] prescription table
- [ ] 1-0-1 style frequency presets
- [ ] duration presets
- [ ] route
- [ ] tests
- [ ] advice
- [ ] follow-up
- [ ] draft
- [ ] complete
- [ ] print

## Prescription

- [ ] A4
- [ ] supplied PDF-like structure
- [ ] Meenakshi branding
- [ ] patient details
- [ ] doctor details
- [ ] vitals
- [ ] symptoms
- [ ] examination
- [ ] assessment
- [ ] tests
- [ ] medicine columns
- [ ] notes
- [ ] footer
- [ ] page numbers
- [ ] reprint history

## Reports

- [ ] private storage
- [ ] upload name/category
- [ ] related visit/IP
- [ ] pending/ready/reviewed
- [ ] report follow-up
- [ ] signed/authenticated view

## Pharmacy

- [ ] table views
- [ ] medicine master
- [ ] batches
- [ ] stock
- [ ] low stock
- [ ] expiry
- [ ] pending Rx
- [ ] dispense
- [ ] atomic quantity change
- [ ] no negative stock
- [ ] sales
- [ ] IP charge link
- [ ] doctor sees availability but prescribing does NOT reduce stock
- [ ] stock reduces only on actual pharmacy dispense
- [ ] partial dispense reduces only actual dispensed quantity
- [ ] 1,000-row Excel/CSV bulk import
- [ ] downloadable Excel template
- [ ] import preview + validation + error rows

## IP

- [ ] create ticket
- [ ] doctor
- [ ] room/bed
- [ ] doctor charges
- [ ] ward/room/bed charges
- [ ] treatment charges
- [ ] tests
- [ ] pharmacy charges
- [ ] other charges
- [ ] payments
- [ ] total/paid/balance
- [ ] progress notes
- [ ] discharge
- [ ] print running ticket
- [ ] print final bill
- [ ] print discharge summary

## Monthly Export

- [ ] Admin-only Monthly Export page
- [ ] Data-only ZIP
- [ ] Data + uploaded documents ZIP
- [ ] patient records included
- [ ] monthly transactional data included
- [ ] manifest included
- [ ] export audit events
- [ ] private temporary export storage
- [ ] signed expiring download
- [ ] generated export retention/cleanup

## Analytics

- [ ] admin full dashboard
- [ ] reception dashboard
- [ ] OP dashboard
- [ ] doctor dashboard
- [ ] IP dashboard
- [ ] pharmacy dashboard
- [ ] date filters
- [ ] server-side aggregates
- [ ] useful charts
- [ ] useful detail tables
- [ ] no doctor revenue analytics exposed to doctor role

## Performance

- [ ] server pagination
- [ ] debounced autocomplete
- [ ] indexed search
- [ ] stale request cancellation
- [ ] no unbounded selects
- [ ] virtualization only where useful
- [ ] no N+1 hotspot
- [ ] no client-side aggregation of massive datasets

## Reliability

- [ ] token concurrency safe
- [ ] stock concurrency safe
- [ ] payment duplicate protection
- [ ] IP charge duplicate protection
- [ ] no hard delete clinical history
- [ ] audit events
- [ ] errors handled

## Testing

- [ ] unit tests
- [ ] integration tests
- [ ] E2E core flows
- [ ] role isolation tests
- [ ] RLS tests
- [ ] print tests
- [ ] mobile tests
- [ ] production build passes

---

# 78. DEFINITION OF DONE

The project is done only when this exact real-world scenario works cleanly:

```text
Reception logs in
→ searches patient by phone
→ opens patient history
→ creates OP visit
→ records offline collection
→ gets unique token
→ prints token without money
→ OP records vitals
→ doctor sees only own queue
→ doctor opens patient
→ doctor sees previous clinical history
→ doctor uses local autocomplete for diagnosis/test/medicine
→ doctor creates prescription using table rows and 1-0-1 presets
→ doctor orders report
→ doctor marks follow-up after report
→ doctor completes visit
→ prints professional A4 Meenakshi prescription
→ doctor can see current pharmacy availability while prescribing
→ prescribing itself does NOT reduce stock
→ pharmacy dispenses and only the actual dispensed quantity reduces safely
→ if pharmacy does not dispense, stock remains unchanged
→ report is uploaded privately
→ reception sees report ready
→ creates linked follow-up visit
→ doctor reviews report
→ if required doctor recommends admission
→ IP creates one ticket
→ doctor/room/bed/treatment/test/pharmacy charges accumulate
→ offline payments accumulate
→ total/paid/balance are correct
→ patient is discharged
→ bill and discharge summary print
→ years later the same phone Patient ID opens the complete history
→ Admin/Pharmacy can download the official Excel medicine template
→ a 1,000-row medicine file can be validated, previewed and bulk imported safely
→ Admin can generate a monthly ZIP export containing patient records and related hospital data.
```

The final system must remain **simple to use even though the implementation underneath is production-grade**.

---

# 79. FINAL CLARIFIED BUSINESS RULES

These rules override any ambiguous wording elsewhere in this file.

## Token

```text
Token print = NO money.
```

Never print:

```text
consultation fee
amount collected
balance
payment mode
```

## Patient ID

```text
Visible Patient ID = normalized phone number
Internal database identity = UUID
```

## Prescription and stock

```text
Doctor prescribes
    ≠
stock reduction
```

Stock changes only when Pharmacy confirms actual dispensing.

```text
Prescribed 10
Dispensed 0  → stock change 0

Prescribed 10
Dispensed 6  → stock change -6

Prescribed 10
Dispensed 10 → stock change -10
```

## Doctor medicine search

Doctor gets fast local suggestions and current availability.

Do not fetch the entire medicine/clinical directory to the browser.

## Bulk medicine import

```text
Download template
→ fill up to 1,000+ rows
→ drag/drop Excel or CSV
→ validate
→ preview
→ confirm
→ bulk import
```

## Monthly export

```text
Admin
→ choose month
→ generate
→ download ZIP
```

Export includes patient master records and relevant monthly OP/IP/pharmacy/clinical/payment/report metadata, with optional uploaded documents.

## UI

Keep the interface simple:

```text
Dashboard
Tables
Dialogs
Tabs
Search
Print
```

All interactive UI remains shadcn/ui only.

Production complexity stays behind the interface.

Mobile requirements:

- sidebar becomes responsive shadcn Sheet/Sidebar
- tables scroll horizontally where necessary
- important actions remain reachable
- dialogs fit viewport
- long forms stack vertically
- prescription rows remain editable
- upload/camera actions work
- print actions remain accessible
- no horizontal page overflow
- dashboard cards become 1–2 columns appropriately

# ================================================== 28. FINAL ACCEPTANCE ADDITIONS

Add these items to the existing AGENTS.md acceptance checklist:

SHADCN:

- [ ] dashboard-01 is the actual dashboard base
- [ ] login-01 is the login base
- [ ] official shadcn Sidebar pattern used
- [ ] all roles use the same dashboard design system
- [ ] no second UI library introduced

FILES:

- [ ] maximum stored patient file size is 1 MB
- [ ] image compression happens locally before upload
- [ ] large images are resized intelligently
- [ ] readability is preserved
- [ ] images unable to reach 1 MB safely are rejected
- [ ] PDFs over 1 MB are rejected
- [ ] server validates the 1 MB limit
- [ ] mobile camera upload works
- [ ] patient storage remains private

PHARMACY:

- [ ] doctor can see medicine availability
- [ ] prescription creation never decreases stock
- [ ] stock decreases only on confirmed dispense
- [ ] partial dispense decreases only actual quantity
- [ ] no dispense means no stock change
- [ ] FEFO batch suggestion implemented
- [ ] negative stock impossible
- [ ] duplicate dispense protected

BULK IMPORT:

- [ ] downloadable XLSX template
- [ ] CSV supported
- [ ] XLSX supported
- [ ] minimum 1,000 rows supported
- [ ] drag/drop upload
- [ ] validation before import
- [ ] preview before confirmation
- [ ] duplicate medicine normalization
- [ ] bulk database operations used
- [ ] invalid rows downloadable
- [ ] browser remains responsive

MONTHLY EXPORT:

- [ ] Admin-only
- [ ] choose month
- [ ] Data Only export
- [ ] Data + Documents export
- [ ] patient records included
- [ ] OP/IP/pharmacy/payment/clinical records included
- [ ] ZIP generated privately
- [ ] short-lived signed download
- [ ] export audit recorded
- [ ] temporary exports cleaned up

PRINT:

- [ ] token contains no financial information
- [ ] prescription follows supplied PDF structure
- [ ] prescription is A4 print-safe
- [ ] long prescriptions paginate correctly

PERFORMANCE:

- [ ] patient search debounced
- [ ] medicine search debounced
- [ ] clinical directory search debounced
- [ ] stale requests cancelled
- [ ] server pagination used
- [ ] no full medicine directory loaded into browser
- [ ] no full patient database loaded into browser
- [ ] bulk imports do not make one request per row
- [ ] analytics are aggregated server-side

# ================================================== 29. DO NOT OVERCOMPLICATE THE PRODUCT

These additions are implementation requirements.

They must NOT make the hospital staff workflow complicated.

The visible workflow stays:

Patient
→ Create Visit
→ Print Token
→ Vitals
→ Doctor
→ Prescription / Tests
→ Pharmacy / Follow-up
→ IP only when needed

Admin screens remain primarily:

Dashboard
Tables
Search
Filters
Dialogs
Reports

Do not introduce unnecessary workflows, approvals, screens, or enterprise HMS features that are not required by the existing AGENTS.md.

# ================================================== 30. APPLY THE UPDATE

Now:

1. Read the COMPLETE existing AGENTS.md first.
2. Integrate these additions into the appropriate existing sections.
3. Do not merely append duplicate requirements if a suitable section already exists.
4. Resolve duplicate wording cleanly.
5. Do not remove existing functionality.
6. Do not weaken authorization/RLS/security.
7. Keep shadcn/ui ONLY.
8. Keep Supabase Auth + PostgreSQL + Storage.
9. Do not add Tigris/S3.
10. Update the final acceptance checklist.
11. Ensure there are no contradictions.
12. Ensure the architecture stays optimized for a small hospital deployment of roughly 20 active staff while remaining safe to scale beyond that.
13. Run a final AGENTS.md consistency audit after editing.

DO NOT START IMPLEMENTING THE APPLICATION AS PART OF THIS TASK UNLESS EXPLICITLY INSTRUCTED.

For this task, update and finalize AGENTS.md first.

Return:

- summary of sections changed
- any conflicts found and how they were resolved
- confirmation that AGENTS.md is internally consistent

Monthly export retention:

- Generated exports remain stored permanently by default.
- EXPORT_RETENTION_DAYS=0 means NO automatic deletion.
- Admin can manually delete an old generated ZIP.
- Deleting an export ZIP must NEVER delete patients, visits, reports, prescriptions, IP records or any database data.

1,000 medicine rows per upload is perfect for V1. Keep it as a per-file limit, not a total database limit.
For monthly exports, I would not auto-delete hospital records ever. For generated ZIPs, since you want to keep them, EXPORT_RETENTION_DAYS=0 is fine.
But I would make Data Only the normal monthly export. Those ZIPs should stay relatively small.
Data + Documents duplicates all uploaded reports/images inside the ZIP, so keeping many of those forever can eat Supabase Storage quickly. For those, Admin should have a clear Delete Export ZIP button.
Deleting an export ZIP must never delete the actual patient/report/database records.

So I'd set:

# 1 MB maximum patient upload

PATIENT_DOCUMENT_MAX_BYTES=1048576

# 0 = never automatically delete exports

EXPORT_RETENTION_DAYS=0

# 1,000 rows maximum per individual medicine import file

MEDICINE_IMPORT_MAX_ROWS=1000

And the UI can simply show:

Monthly Exports

Aug 2026 Data Only 4.2 MB [Download] [Delete]
Jul 2026 Data + Documents 86 MB [Download] [Delete]
Jun 2026 Data Only 3.8 MB [Download] [Delete]

For your ~20-user hospital setup, this is simple, sensible, and enough. I wouldn't add complicated scheduled deletion rules now.

fix all rls of supabase okie na
set admin email pass as admin@meenakshihospital.com pass Meenakshi@2026
