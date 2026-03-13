import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function getDatabaseUrl(): string {
  let url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() === "host") {
      parsed.hostname = "localhost";
      url = parsed.toString();
      console.warn("DATABASE_URL hostname was 'HOST'; using 'localhost' for development.");
    }
  } catch {
    // If parsing fails, let the driver throw a clear error
  }

  return url;
}

let _db: ReturnType<typeof drizzle> | null = null;

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    if (!_db) {
      const queryClient = postgres(getDatabaseUrl(), { max: 1 });
      _db = drizzle(queryClient);
    }
    return (_db as Record<string | symbol, unknown>)[prop];
  },
});


