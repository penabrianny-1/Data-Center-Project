/**
 * Validate curated seed files against lib/schema.ts.
 *
 *   npm run validate                       # all files in data/seed/
 *   npm run validate -- data/seed/bills.json
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SEED_FILES } from "../lib/schema";

const SEED_DIR = "data/seed";

function validate(path: string): boolean {
  // Shards like state-policy.part1.json validate against their base file's schema.
  const name = basename(path).replace(/\.part\d+\.json$/, ".json") as keyof typeof SEED_FILES;
  const schema = SEED_FILES[name];
  if (!schema) {
    console.error(`✗ ${path}: unknown seed file (expected one of ${Object.keys(SEED_FILES).join(", ")})`);
    return false;
  }
  if (!existsSync(path)) {
    console.warn(`- ${path}: missing (skipped)`);
    return true;
  }

  let records: unknown;
  try {
    records = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`✗ ${path}: invalid JSON — ${(err as Error).message}`);
    return false;
  }
  if (!Array.isArray(records)) {
    console.error(`✗ ${path}: top level must be a JSON array`);
    return false;
  }

  let errors = 0;
  const ids = new Set<string>();
  records.forEach((record, i) => {
    const result = schema.safeParse(record);
    const label = (record as { id?: string; state?: string })?.id ?? (record as { state?: string })?.state ?? `#${i}`;
    if (!result.success) {
      errors++;
      for (const issue of result.error.issues.slice(0, 5)) {
        console.error(`  ✗ [${label}] ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      }
    }
    const key = (record as { id?: string }).id;
    if (key) {
      if (ids.has(key)) {
        errors++;
        console.error(`  ✗ duplicate id ${key}`);
      }
      ids.add(key);
    }
  });

  console.log(`${errors ? "✗" : "✓"} ${path}: ${records.length} records, ${errors} invalid`);
  return errors === 0;
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : Object.keys(SEED_FILES).flatMap((f) => {
      const shards = existsSync(SEED_DIR)
        ? readdirSync(SEED_DIR).filter((x) => x.startsWith(f.replace(/\.json$/, ".part")) && x.endsWith(".json"))
        : [];
      return [...(existsSync(join(SEED_DIR, f)) || !shards.length ? [join(SEED_DIR, f)] : []), ...shards.map((x) => join(SEED_DIR, x))];
    });

const ok = targets.map(validate).every(Boolean);
process.exit(ok ? 0 : 1);
