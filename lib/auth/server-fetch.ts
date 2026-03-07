import { cookies } from "next/headers";

/**
 * Server-side fetch that forwards the current user's session cookies
 * to internal API routes. Use this in Server Components / Server Actions
 * instead of manually building the cookie header each time.
 */
export async function serverFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const cookieStore = await (cookies() as unknown as Promise<
    ReturnType<typeof cookies>
  >);
  const cookieHeader = cookieStore
    .getAll()
    .map(
      (c: { name: string; value: string }) =>
        `${c.name}=${encodeURIComponent(c.value)}`
    )
    .join("; ");

  const base = process.env.NEXTAUTH_URL ?? "";

  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...((init?.headers as Record<string, string>) ?? {}),
    },
    cache: "no-store",
  });
}
