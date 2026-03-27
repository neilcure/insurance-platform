import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

let _db: ReturnType<typeof drizzle> | null = null;

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    if (!_db) {
      const queryClient = postgres(getDatabaseUrl(), {
        max: 10,
        idle_timeout: 20,
        ssl: "require",
        types: {
          date: { to: 1184, from: [1082, 1083, 1114, 1184], serialize: (v: unknown) => v, parse: (v: string) => v },
        },
      });
      _db = drizzle(queryClient);
    }
    return (_db as unknown as Record<string | symbol, unknown>)[prop];
  },
});


