/**
 * Import the current active English terminology from an official SNOMED CT
 * International RF2 Snapshot package.
 *
 * The Full history, relationships, OWL and refset internals are intentionally
 * not copied into the operational HMS database. Every active concept is loaded
 * once with its current FSN, preferred English term and active synonyms. This
 * turns a ~3.6 GB extracted release into a compact, indexed terminology store.
 *
 * Dry run:
 *   node scripts/import-snomed-rf2.mjs /path/to/extracted/release
 *
 * Import (the project ref must match .env):
 *   node scripts/import-snomed-rf2.mjs /path/to/extracted/release \
 *     --project <ref> --yes
 */
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const execute = args.includes("--yes");
const projectIndex = args.indexOf("--project");
const projectArg = projectIndex >= 0 ? args[projectIndex + 1] : undefined;
const releaseDirectory = args.find((arg) => !arg.startsWith("--") && arg !== projectArg);
const ref = process.env.SUPABASE_PROJECT_ID;
const password = process.env.SUPABASE_DB_PASSWORD;

if (!releaseDirectory) throw new Error("Pass the extracted RF2 release directory.");
if (!ref || !password) {
  throw new Error("SUPABASE_PROJECT_ID and SUPABASE_DB_PASSWORD are required in .env.");
}
if (execute && projectArg !== ref) {
  throw new Error(`Refusing to import. Pass --project ${ref} to confirm the target database.`);
}

const snapshot = join(releaseDirectory, "Snapshot");
const terminology = join(snapshot, "Terminology");
const language = join(snapshot, "Refset", "Language");
const packageInfoFile = join(releaseDirectory, "release_package_information.json");
const findOne = (directory, pattern) => {
  const matches = readdirSync(directory).filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${pattern} file in ${directory}; found ${matches.length}.`);
  }
  return join(directory, matches[0]);
};

if (!existsSync(packageInfoFile)) throw new Error(`Missing ${packageInfoFile}`);
const conceptFile = findOne(terminology, /^sct2_Concept_Snapshot_.*\.txt$/);
const descriptionFile = findOne(terminology, /^sct2_Description_Snapshot-en_.*\.txt$/);
const languageFile = findOne(language, /^der2_cRefset_LanguageSnapshot-en_.*\.txt$/);
const packageInfo = JSON.parse(readFileSync(packageInfoFile, "utf8"));
const effectiveDate = String(packageInfo.effectiveTime ?? "").replace(
  /^(\d{4})(\d{2})(\d{2})$/,
  "$1-$2-$3",
);
if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
  throw new Error("release_package_information.json has no valid effectiveTime.");
}

const FSN = "900000000000003001";
const SYNONYM = "900000000000013009";
const PREFERRED = "900000000000548007";
const US_ENGLISH = "900000000000509007";
const GB_ENGLISH = "900000000000508004";

async function lines(file, onLine) {
  const input = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });
  let header = true;
  for await (const line of input) {
    if (header) {
      header = false;
      continue;
    }
    if (line) onLine(line.split("\t"));
  }
}

console.log(`Release: SNOMED CT International Edition ${effectiveDate}`);
console.log(`Mode:    ${execute ? "IMPORT" : "dry run"}`);

let sourceConceptCount = 0;
const concepts = new Map();
await lines(conceptFile, (row) => {
  sourceConceptCount += 1;
  const [conceptId, rowEffectiveTime, active, moduleId, definitionStatusId] = row;
  if (active !== "1") return;
  concepts.set(conceptId, {
    concept_id: conceptId,
    effective_date: rowEffectiveTime.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
    module_id: moduleId,
    definition_status_id: definitionStatusId,
    active: true,
    preferred_term: "",
    fully_specified_name: "",
    semantic_tag: null,
    synonyms: [],
    search_text: "",
    is_clinical_finding: false,
    preferredRank: 99,
  });
});
console.log(`Active concepts: ${concepts.size.toLocaleString("en-IN")}`);

const usPreferred = new Set();
const gbPreferred = new Set();
await lines(languageFile, (row) => {
  const [, , active, , refsetId, descriptionId, acceptabilityId] = row;
  if (active !== "1" || acceptabilityId !== PREFERRED) return;
  if (refsetId === US_ENGLISH) usPreferred.add(descriptionId);
  else if (refsetId === GB_ENGLISH) gbPreferred.add(descriptionId);
});
console.log(
  `Preferred descriptions: US ${usPreferred.size.toLocaleString("en-IN")}, ` +
  `GB ${gbPreferred.size.toLocaleString("en-IN")}`,
);

let sourceDescriptionCount = 0;
let loadedDescriptionCount = 0;
await lines(descriptionFile, (row) => {
  sourceDescriptionCount += 1;
  const [descriptionId, , active, , conceptId, languageCode, typeId, term] = row;
  if (active !== "1" || languageCode !== "en") return;
  const concept = concepts.get(conceptId);
  if (!concept) return;
  loadedDescriptionCount += 1;
  if (typeId === FSN) {
    concept.fully_specified_name = term;
    const tag = term.match(/\s\(([^()]*)\)$/)?.[1]?.trim().toLowerCase();
    concept.semantic_tag = tag || null;
    concept.is_clinical_finding = tag === "finding" || tag === "disorder";
    return;
  }
  if (typeId !== SYNONYM) return;
  const preferredRank = usPreferred.has(descriptionId) ? 0 : gbPreferred.has(descriptionId) ? 1 : 99;
  if (preferredRank < concept.preferredRank) {
    if (concept.preferred_term) concept.synonyms.push(concept.preferred_term);
    concept.preferred_term = term;
    concept.preferredRank = preferredRank;
  } else {
    concept.synonyms.push(term);
  }
});

usPreferred.clear();
gbPreferred.clear();

let clinicalFindingCount = 0;
let synonymCount = 0;
for (const concept of concepts.values()) {
  if (!concept.fully_specified_name) {
    throw new Error(`Active concept ${concept.concept_id} has no active FSN.`);
  }
  if (!concept.preferred_term) {
    concept.preferred_term = concept.fully_specified_name.replace(/\s\([^()]*\)$/, "");
  }
  const preferredKey = concept.preferred_term.toLocaleLowerCase("en");
  const unique = new Map();
  for (const synonym of concept.synonyms) {
    const clean = synonym.replace(/\s+/g, " ").trim();
    const key = clean.toLocaleLowerCase("en");
    if (clean && key !== preferredKey && !unique.has(key)) unique.set(key, clean);
  }
  concept.synonyms = [...unique.values()];
  synonymCount += concept.synonyms.length;
  if (concept.is_clinical_finding) clinicalFindingCount += 1;
  concept.search_text = [
    concept.preferred_term,
    concept.fully_specified_name,
    ...concept.synonyms,
  ].join(" ");
  delete concept.preferredRank;
}

console.log(`Attached descriptions: ${loadedDescriptionCount.toLocaleString("en-IN")}`);
console.log(`Search synonyms:       ${synonymCount.toLocaleString("en-IN")}`);
console.log(`Clinical findings:     ${clinicalFindingCount.toLocaleString("en-IN")}`);

if (!execute) {
  console.log(`\nNothing was changed. To import for real:\n  node scripts/import-snomed-rf2.mjs "${releaseDirectory}" --project ${ref} --yes`);
  process.exit(0);
}

const poolerHost = process.env.SUPABASE_DB_POOLER_HOST ?? "aws-0-ap-south-1.pooler.supabase.com";
const client = new pg.Client({
  connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${poolerHost}:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const schemaCheck = await client.query(
  "select to_regclass('public.snomed_concepts') is not null as ready",
);
if (!schemaCheck.rows[0].ready) {
  await client.end();
  throw new Error("SNOMED schema is missing. Apply database migrations first.");
}

try {
  await client.query("begin");
  await client.query("update public.snomed_releases set is_current = false where is_current");
  const releaseResult = await client.query(
    `insert into public.snomed_releases(
       edition, effective_date, source_package, license_statement,
       source_concept_count, source_description_count, status, is_current
     ) values ($1, $2, $3, $4, $5, $6, 'importing', true)
     on conflict (edition, effective_date) do update set
       source_package = excluded.source_package,
       license_statement = excluded.license_statement,
       source_concept_count = excluded.source_concept_count,
       source_description_count = excluded.source_description_count,
       loaded_concept_count = 0,
       loaded_description_count = 0,
       status = 'importing',
       is_current = true,
       imported_at = null
     returning id`,
    [
      "International Edition",
      effectiveDate,
      basename(releaseDirectory),
      packageInfo.licenceStatement,
      sourceConceptCount,
      sourceDescriptionCount,
    ],
  );
  const releaseId = releaseResult.rows[0].id;
  await client.query("truncate table public.snomed_concepts");

  const rows = [...concepts.values()];
  const batchSize = 500;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    await client.query(
      `insert into public.snomed_concepts(
         concept_id, release_id, effective_date, module_id,
         definition_status_id, active, preferred_term, fully_specified_name,
         semantic_tag, synonyms, search_text, is_clinical_finding
       )
       select source.concept_id, $2::uuid, source.effective_date,
              source.module_id, source.definition_status_id, source.active,
              source.preferred_term, source.fully_specified_name,
              source.semantic_tag, source.synonyms, source.search_text,
              source.is_clinical_finding
       from jsonb_to_recordset($1::jsonb) as source(
         concept_id text, effective_date date, module_id text,
         definition_status_id text, active boolean, preferred_term text,
         fully_specified_name text, semantic_tag text, synonyms text[],
         search_text text, is_clinical_finding boolean
       )`,
      [JSON.stringify(batch), releaseId],
    );
    if ((index + batch.length) % 25000 === 0 || index + batch.length === rows.length) {
      console.log(`Imported ${(index + batch.length).toLocaleString("en-IN")} / ${rows.length.toLocaleString("en-IN")}`);
    }
  }

  await client.query(
    `update public.snomed_releases
     set loaded_concept_count = $2,
         loaded_description_count = $3,
         status = 'ready',
         imported_at = now()
     where id = $1`,
    [releaseId, rows.length, loadedDescriptionCount],
  );
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}

console.log("SNOMED CT import complete.");
