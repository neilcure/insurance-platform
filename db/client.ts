import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

// Normalize accidental placeholder host names to localhost to avoid DNS errors in dev
try {
  const parsed = new URL(databaseUrl);
  if (parsed.hostname.toLowerCase() === "host") {
    parsed.hostname = "localhost";
    databaseUrl = parsed.toString();
    console.warn("DATABASE_URL hostname was 'HOST'; using 'localhost' for development.");
  }
} catch {
  // If parsing fails, let the driver throw a clear error
}

const queryClient = postgres(databaseUrl, { max: 1 });
export const db = drizzle(queryClient);


