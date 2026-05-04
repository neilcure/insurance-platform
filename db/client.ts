import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

// Pool sizing notes:
// - On serverless hosts every warm instance keeps its own pool, so total
//   connections to Postgres = `DB_POOL_MAX` × number of warm instances.
//   Keep this small (default 5) and use Neon's pooled URL in production
//   to stay safely under the project's connection limit.
// - On a long-running Node host you can raise it (e.g. 20) since there
//   is only one process holding the pool.
function getPoolMax(): number {
  const raw = process.env.DB_POOL_MAX;
  if (!raw) return 5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(n, 100);
}

function getIdleTimeout(): number {
  const raw = process.env.DB_IDLE_TIMEOUT;
  if (!raw) return 20;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 20;
  return n;
}

let _db: ReturnType<typeof drizzle> | null = null;

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    if (!_db) {
      const url = getDatabaseUrl();
      const max = getPoolMax();
      const idleTimeout = getIdleTimeout();
      const queryClient = postgres(url, {
        max,
        idle_timeout: idleTimeout,
        ssl: "require",
        types: {
          date: { to: 1184, from: [1082, 1083, 1114, 1184], serialize: (v: unknown) => v, parse: (v: string) => v },
        },
      });
      if (process.env.NODE_ENV !== "production") {
        // Help diagnose pool/connection issues without leaking the password.
        try {
          const u = new URL(url);
          const host = u.host;
          const isPooler = host.includes("-pooler.") || host.includes(".pooler.");
          // eslint-disable-next-line no-console
          console.info(`[db] connected host=${host} pool_max=${max} idle_timeout=${idleTimeout} pooled=${isPooler}`);
        } catch {
          /* ignore — bad URL parse shouldn't block startup */
        }
      }
      _db = drizzle(queryClient);
    }
    return (_db as unknown as Record<string | symbol, unknown>)[prop];
  },
});


