import { Pool } from "pg";

// Reused across invocations in the same serverless instance.
// Supabase's pooled connection string (port 6543) is required for serverless.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
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
