import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(databaseUrl: string): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
  }
  return pool;
}

export async function withClient<T>(
  databaseUrl: string,
  handler: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool(databaseUrl).connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
}
