import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq } from "drizzle-orm";

type AgentRow = {
  id: number;
  userNumber: string | null;
  email: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
};

export async function GET() {
  try {
    const me = await requireUser();
    // Admin/Internal Staff: all agents
    // Agent: only self
    // Others: none
    if (me.userType === "admin" || me.userType === "internal_staff") {
      const rows =
        (await db
          .select({
            id: users.id,
            userNumber: users.userNumber,
            email: users.email,
            name: users.name,
            isActive: users.isActive,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.userType, "agent" as any))) as unknown as AgentRow[];
      return NextResponse.json(rows, { status: 200 });
    }
    if (me.userType === "agent") {
      const rows =
        (await db
          .select({
            id: users.id,
            userNumber: users.userNumber,
            email: users.email,
            name: users.name,
            isActive: users.isActive,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(and(eq(users.userType, "agent" as any), eq(users.id, Number(me.id))))) as unknown as AgentRow[];
      return NextResponse.json(rows, { status: 200 });
    }
    return NextResponse.json([], { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

