import { requireUser } from "@/lib/auth/require-user";
import { redirect } from "next/navigation";
import { SettingsBlock } from "@/components/ui/settings-block";
import { FieldResolverDiagPanel } from "@/components/admin/FieldResolverDiagPanel";
import { PolicyStatusDiagPanel } from "@/components/admin/PolicyStatusDiagPanel";

export default async function FieldResolverDiagPage() {
  const me = await requireUser();
  if (me.userType !== "admin") redirect("/dashboard");

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">System Diagnostics</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Verify that dynamic package fields, policy data, and status configurations are working correctly.
        </p>
      </div>

      <SettingsBlock
        title="Field Resolver"
        description="Enter a policy number to see all resolved field values — verify that your configured packages and fields are captured and output correctly."
      >
        <FieldResolverDiagPanel />
      </SettingsBlock>

      <SettingsBlock
        title="Data Sources"
        description="Available sources and field keys you can use in document and PDF templates."
      >
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-left font-medium">Example Keys</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700">
              {[
                { source: "policy", desc: "Policy-level attributes", keys: "policyNumber, createdAt, status, flowKey, effectiveDate, expiryDate" },
                { source: "insured", desc: "Insured snapshot (name, ID, etc.)", keys: "displayName, primaryId, lastName, firstName, companyName, insuredType" },
                { source: "contactinfo", desc: "Contact fields (phone, address, etc.)", keys: "mobile, tel, email, fullAddress" },
                { source: "package", desc: "Package snapshot values (requires packageName)", keys: "Any field key configured in your package" },
                { source: "agent", desc: "Agent record", keys: "name, email, agentNumber" },
                { source: "client", desc: "Client record", keys: "displayName, clientNumber, category, primaryId" },
                { source: "organisation", desc: "Organisation / insurer record", keys: "name, fullAddress, contactName, contactEmail" },
                { source: "accounting", desc: "Premium line items", keys: "Your configured premium field keys + insurerName, collaboratorName" },
                { source: "invoice", desc: "Invoice record fields", keys: "invoiceNumber, invoiceDate, dueDate, totalAmount, status" },
                { source: "statement", desc: "Statement record + line items", keys: "statementNumber, entityName, activeTotal, item_{premiumKey}" },
                { source: "static", desc: "Fixed text value", keys: "(any literal string)" },
              ].map((r) => (
                <tr key={r.source}>
                  <td className="px-3 py-2 font-mono text-xs text-blue-600 dark:text-blue-400">{r.source}</td>
                  <td className="px-3 py-2">{r.desc}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">{r.keys}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsBlock>

      <SettingsBlock
        title="Policy Status System"
        description="Status configuration health check — verifies all statuses are properly configured with colors and no duplicates."
      >
        <PolicyStatusDiagPanel />
      </SettingsBlock>
    </main>
  );
}
