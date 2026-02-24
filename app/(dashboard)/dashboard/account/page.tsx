import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/db/client";
import { memberships, organisations, users } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { AccountInfoWizard } from "@/components/account/AccountInfoWizard";
import { ServerErrorToast } from "@/components/ui/ServerErrorToast";

export default async function AccountPage() {
  const me = await requireUser();
  const userId = Number(me.id);

  let loadError: string | undefined;
  let u:
    | {
        id: number;
        email: string;
        name: string | null;
        timezone?: string | null;
      }
    | undefined;
  try {
    [u] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
  } catch (err: any) {
    loadError = err?.message ?? "Failed to load account info";
  }

  let orgRow:
    | {
        organisationId: number;
        organisationName: string;
        contactName: string | null;
        contactEmail: string | null;
        contactPhone: string | null;
        flatNumber: string | null;
        floorNumber: string | null;
        blockNumber: string | null;
        blockName: string | null;
        streetNumber: string | null;
        streetName: string | null;
        propertyName: string | null;
        districtName: string | null;
        area: string | null;
      }
    | undefined;
  if (!loadError) {
    try {
      [orgRow] = await db
        .select({
          organisationId: organisations.id,
          organisationName: organisations.name,
          contactName: organisations.contactName,
          contactEmail: organisations.contactEmail,
          contactPhone: organisations.contactPhone,
          flatNumber: organisations.flatNumber,
          floorNumber: organisations.floorNumber,
          blockNumber: organisations.blockNumber,
          blockName: organisations.blockName,
          streetNumber: organisations.streetNumber,
          streetName: organisations.streetName,
          propertyName: organisations.propertyName,
          districtName: organisations.districtName,
          area: organisations.area,
        })
        .from(memberships)
        .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
        .where(eq(memberships.userId, userId))
        .limit(1);
    } catch (err: any) {
      loadError = err?.message ?? "Failed to load account info";
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8">
      {loadError ? <ServerErrorToast message={loadError} /> : null}
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Account</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Update your personal and organisation information.
        </p>
      </div>
      <AccountInfoWizard
        initial={{
          user: u ?? null,
          organisation: orgRow
            ? {
                id: orgRow.organisationId,
                name: orgRow.organisationName,
                contactName: orgRow.contactName ?? undefined,
                contactEmail: orgRow.contactEmail ?? undefined,
                contactPhone: orgRow.contactPhone ?? undefined,
                flatNumber: orgRow.flatNumber ?? undefined,
                floorNumber: orgRow.floorNumber ?? undefined,
                blockNumber: orgRow.blockNumber ?? undefined,
                blockName: orgRow.blockName ?? undefined,
                streetNumber: orgRow.streetNumber ?? undefined,
                streetName: orgRow.streetName ?? undefined,
                propertyName: orgRow.propertyName ?? undefined,
                districtName: orgRow.districtName ?? undefined,
                area: orgRow.area ?? undefined,
              }
            : null,
        }}
      />
    </main>
  );
}

