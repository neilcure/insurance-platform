import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { compare } from "bcryptjs";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { eq } from "drizzle-orm";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null;
          const rows = await db.select().from(users).where(eq(users.email, credentials.email)).limit(1);
          const user = rows[0];
          if (!user) return null;
          const ok = await compare(credentials.password, user.passwordHash);
          if (!ok) return null;
          return { id: String(user.id), email: user.email, name: user.name ?? undefined, userType: user.userType };
        } catch (err) {
          console.error("Authorize failed:", err);
          // Return null to avoid crashing the sign-in flow if DB is unavailable
          return null;
        }
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Credentials sign-in already returns our DB user from authorize()
      if (account?.provider === "credentials") return true;

      // For Google OAuth, only allow sign-in for existing ACTIVE users by email.
      // This prevents uninvited account creation and avoids bypassing invite activation.
      if (account?.provider === "google") {
        const email = String(user?.email ?? "").trim().toLowerCase();
        if (!email) return false;

        const rows = await db
          .select({ id: users.id, userType: users.userType, name: users.name, isActive: users.isActive })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        const u = rows[0];
        if (!u) return false;
        if (!u.isActive) return false;

        // Stamp our DB identity onto the NextAuth user so jwt/session callbacks can use it
        (user as any).id = String(u.id);
        (user as any).userType = u.userType;
        // Best-effort: keep DB name if present; otherwise keep OAuth name as-is
        return true;
      }

      // Unknown provider: deny by default
      return false;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.userType = (user as any).userType;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).userType = token.userType;
      }
      return session;
    },
  },
};


