# Cleanup approval checklist

This file is a review checklist only. Nothing in it has been removed.

**Safety rule:** do not run `scripts/e2e-teardown.mjs` with `--yes`, do not
delete patient records, and do not remove directory records until the owner
replies with the exact selected section(s) below.

## Select what to remove

- [ ] **A. Marked E2E patient data only**

  Removes only rows created by automated tests with explicit E2E markers. This
  includes the linked visits, vitals, consultations, prescriptions, pharmacy
  sales, IP tickets, IP charges/payments, reports, and test-created stock rows.
  It must not touch normal hospital patients or their clinical history.

- [ ] **B. E2E medicine and batch data only**

  Removes only medicine directory/batch rows bearing the explicit test markers
  (`ZZ E2E` or `ZZ API`) and restores the stock movements caused by those test
  records. This is normally included with A, but is separate here so it can be
  reviewed independently.

- [ ] **C. All Clinical Directory rows**

  This means all rows in `clinical_terms`, including hospital-created terms,
  ICD/WHO cached terms, and seeded terms. It is not part of E2E teardown and
  requires a separate, scoped approval after an export/count review.

  Important effects to confirm before this action:

  - Doctor autocomplete, diagnoses, tests, advice templates, and local search
    will be empty until terms are imported again.
  - Existing consultation diagnosis links may retain their typed diagnosis but
    lose their optional directory-term link where the database allows it.
  - Catalog memberships/import metadata must be checked in the final impact
    report before deletion.

- [ ] **D. Keep everything**

  No cleanup. Leave all E2E fixtures and the directory exactly as they are.

## Required confirmation format

Reply with one of these exact forms:

```text
Approve cleanup: A
Approve cleanup: A + B
Approve cleanup: C
Approve cleanup: A + B + C
Keep everything
```

For **C**, I will first provide a final directory inventory and export/backup
plan. I will not remove the entire clinical directory merely because it is
empty-looking in the UI.

## What is intentionally excluded

- Staff accounts and authentication users
- Hospital settings, departments, charges, rooms, and report categories
- Any patient without an explicit E2E marker
- Any medicine or batch without an explicit E2E/API marker
- Supabase migrations, source code, and storage not linked to marked E2E data

## Evidence required after an approved cleanup

1. Before/after count by each selected table.
2. Confirmation that no unmarked patient or medicine was included.
3. Stock-restoration result for marked test batches.
4. For C, confirmation of the directory export, removed row count, and the
   effect on existing diagnosis links.
