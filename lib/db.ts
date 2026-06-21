import { Pool } from "pg";

// Reused across invocations in the same serverless instance.
// Supabase's pooled connection string (port 6543) is required for serverless.
let pool: Pool | undefined;

// Prefer an explicitly-set DATABASE_URL (e.g. for local dev / dbt), but fall
// back to POSTGRES_URL - the variable name the Supabase<->Vercel marketplace
// integration auto-syncs - so the app works whether you wired the connection
// string up manually or via that integration, without needing to keep both
// in sync by hand. POSTGRES_URL_NON_POOLING is the integration's name for a
// direct (non-pooled) connection, kept as a last resort since it won't scale
// under serverless concurrency the way the pooled URLs do.
function resolveConnectionString(): string {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    throw new Error(
      "No database connection string found. Set DATABASE_URL, or connect Supabase " +
        "via the Vercel integration so POSTGRES_URL is auto-populated."
    );
  }

  // Strip any sslmode param from the URL itself. We configure SSL explicitly
  // below via the `ssl` option instead, so a leftover `sslmode=require` (common
  // in Supabase/Vercel-integration connection strings) is redundant and is what
  // triggers pg-connection-string's "SECURITY WARNING" about sslmode aliasing -
  // removing it avoids relying on a mode whose semantics change in pg v9.
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    // Not a valid URL (e.g. odd characters) - fall back to a regex strip
    // rather than failing outright.
    return connectionString.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
  }
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: resolveConnectionString(),
      max: 5,
      idleTimeoutMillis: 10_000,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const { rows } = await getPool().query(text, params);
  return rows;
}