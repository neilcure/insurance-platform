import type { Config } from "drizzle-kit";

function normalizeDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error("DATABASE_URL is not set");
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() === "host") {
      parsed.hostname = "localhost";
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export default {
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: normalizeDatabaseUrl(process.env.DATABASE_URL),
  },
} satisfies Config;



