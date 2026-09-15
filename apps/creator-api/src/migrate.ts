import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.CREATOR_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("CREATOR_DATABASE_URL is required");
}
const database = new URL(databaseUrl);
if (!["postgres:", "postgresql:"].includes(database.protocol)) {
  throw new Error("CREATOR_DATABASE_URL must use PostgreSQL");
}
const production = process.env.NODE_ENV === "production";
const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  ssl:
    production
      ? { rejectUnauthorized: true }
      : false,
});
const migrationDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

try {
  await sql`select pg_advisory_lock(472910284)`;
  await sql`
    create table if not exists creator_schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;
  const files = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  for (const name of files) {
    const source = await readFile(
      new URL(`../migrations/${name}`, import.meta.url),
      "utf8",
    );
    const checksum = createHash("sha256").update(source).digest("hex");
    const existing = await sql<Array<{ checksum: string }>>`
      select checksum
      from creator_schema_migrations
      where name = ${name}
    `;
    if (existing[0]) {
      if (existing[0].checksum !== checksum) {
        throw new Error(`Applied migration was modified: ${name}`);
      }
      continue;
    }
    await sql.begin(async (transaction) => {
      await transaction.unsafe(source);
      await transaction`
        insert into creator_schema_migrations (name, checksum)
        values (${name}, ${checksum})
      `;
    });
  }
} finally {
  await sql`select pg_advisory_unlock(472910284)`.catch(() => undefined);
  await sql.end({ timeout: 5 });
}
