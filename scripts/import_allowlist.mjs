import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BATCH_SIZE = 500;
const ADDRESS_REGEX = /^0x[a-f0-9]{40}$/i;

function parseEnvLocal(content) {
  const env = {};
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in env)) env[key] = value;
  }
  return env;
}

async function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = path.join(process.cwd(), ".env.local");
  try {
    const envContent = await readFile(envPath, "utf8");
    const envMap = parseEnvLocal(envContent);
    if (envMap.DATABASE_URL) {
      process.env.DATABASE_URL = envMap.DATABASE_URL;
      return envMap.DATABASE_URL;
    }
  } catch {
    // .env.local not available; handled below
  }

  throw new Error("DATABASE_URL is missing. Set env var or add it to .env.local.");
}

function buildBatchInsertQuery(size) {
  const valuesSql = Array.from({ length: size }, (_, i) => `($${i + 1})`).join(", ");
  return `INSERT INTO allowlist_addresses(address) VALUES ${valuesSql} ON CONFLICT (address) DO NOTHING RETURNING address`;
}

async function main() {
  const root = process.cwd();
  const inputPath = path.join(root, "all.txt");
  const csvPath = path.join(root, "allowlist.csv");

  const raw = await readFile(inputPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const totalLines = lines.length;

  const validNormalized = [];
  for (const line of lines) {
    const beforeComma = line.split(",", 1)[0].trim().toLowerCase();
    if (ADDRESS_REGEX.test(beforeComma)) {
      validNormalized.push(beforeComma);
    }
  }

  const deduped = [...new Set(validNormalized)];
  const csvBody = `address\n${deduped.join("\n")}\n`;
  await writeFile(csvPath, csvBody, "utf8");

  const skippedInvalid = totalLines - validNormalized.length;

  await resolveDatabaseUrl();

  let pgModule;
  try {
    pgModule = await import("pg");
  } catch {
    throw new Error('Missing "pg" package. Run: npm i pg');
  }

  const { Client } = pgModule.default ?? pgModule;
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  await client.connect();

  let inserted = 0;
  try {
    for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
      const batch = deduped.slice(i, i + BATCH_SIZE);
      const sql = buildBatchInsertQuery(batch.length);
      const result = await client.query(sql, batch);
      inserted += result.rowCount ?? 0;
    }
  } finally {
    await client.end();
  }

  console.log(`total lines: ${totalLines}`);
  console.log(`valid: ${validNormalized.length}`);
  console.log(`deduped: ${deduped.length}`);
  console.log(`inserted: ${inserted}`);
  console.log(`skipped_invalid: ${skippedInvalid}`);
}

main().catch((error) => {
  console.error(error.message || "Import failed");
  process.exitCode = 1;
});
