import { requireUser } from "@/lib/auth/require-user";
import { redirect } from "next/navigation";
import { SettingsBlock } from "@/components/ui/settings-block";
import { FieldResolverDiagPanel } from "@/components/admin/FieldResolverDiagPanel";

export default async function FieldResolverDiagPage() {
  const me = await requireUser();
  if (me.userType !== "admin") redirect("/dashboard");

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Field Resolver Diagnostics</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          How the system resolves, matches, and formats field values across policies, documents, and PDFs.
          Use this page to debug unexpected output or verify resolver behaviour.
        </p>
      </div>

      <SettingsBlock
        title="Live Test"
        description="Paste a policy number to test field resolution against real data."
      >
        <FieldResolverDiagPanel />
      </SettingsBlock>

      <SettingsBlock
        title="Data Sources"
        description="The resolver routes each field to a data source based on the 'source' property."
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
                { source: "insured", desc: "Insured snapshot with prefix-stripping (insured__)", keys: "displayName, primaryId, lastName, firstName, companyName, insuredType" },
                { source: "contactinfo", desc: "Contact fields with prefix-stripping (contactinfo__)", keys: "mobile, tel, email, fullAddress" },
                { source: "package", desc: "Package snapshot values (requires packageName)", keys: "Any field key within a package's values" },
                { source: "agent", desc: "Agent record (fuzzy key match)", keys: "name, email, agentNumber, contactPhone" },
                { source: "client", desc: "Client record (fuzzy key match)", keys: "displayName, clientNumber, category, primaryId" },
                { source: "organisation", desc: "Organisation record (fuzzy key match + fullAddress)", keys: "name, fullAddress, any org field" },
                { source: "accounting", desc: "Premium line items (supports lineKey + totals)", keys: "grossPremium, netPremium, clientPremium, margin, insurerName" },
                { source: "invoice", desc: "Invoice record fields", keys: "invoiceNumber, invoiceDate, dueDate, totalAmount, status" },
                { source: "statement", desc: "Statement record + line items", keys: "statementNumber, entityName, activeTotal, item_* (dynamic)" },
                { source: "static", desc: "Returns the staticValue directly", keys: "(any literal string)" },
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
        title="Key Matching Strategy"
        description="How the resolver finds values when exact keys don't match."
      >
        <div className="space-y-4">
          <div className="rounded-md border p-4 dark:border-neutral-700">
            <h4 className="mb-2 text-sm font-semibold">1. fuzzyGet (case-insensitive)</h4>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              First tries exact key match, then falls back to case-insensitive comparison.
              Used for agent, client, organisation, and package lookups.
            </p>
            <div className="mt-2 rounded bg-neutral-100 px-3 py-2 font-mono text-xs dark:bg-neutral-800">
              obj[&quot;lastName&quot;] → obj[&quot;lastname&quot;] → obj[&quot;LASTNAME&quot;] ✓
            </div>
          </div>

          <div className="rounded-md border p-4 dark:border-neutral-700">
            <h4 className="mb-2 text-sm font-semibold">2. prefixedGet (insured / contactinfo)</h4>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Tries: direct key → <code>prefix__key</code> → <code>prefix_key</code> → strips all
              known prefixes and compares normalized forms.
            </p>
            <div className="mt-2 rounded bg-neutral-100 px-3 py-2 font-mono text-xs dark:bg-neutral-800">
              <div>insuredGet(snap, &quot;lastName&quot;)</div>
              <div className="text-neutral-500">→ snap.lastName → snap.insured__lastName → snap.insured_lastName → normalize &amp; match</div>
            </div>
          </div>

          <div className="rounded-md border p-4 dark:border-neutral-700">
            <h4 className="mb-2 text-sm font-semibold">3. Package key matching</h4>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Tries: <code>vals[key]</code> → <code>vals[packageName__key]</code> → <code>vals[packageName_key]</code> (all via fuzzyGet).
            </p>
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock
        title="Name Resolution Priority"
        description="How display names are extracted from insured snapshots."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border p-4 dark:border-neutral-700">
            <h4 className="mb-2 text-sm font-semibold text-green-700 dark:text-green-400">Personal (insuredType = &quot;personal&quot;)</h4>
            <ol className="list-decimal pl-5 text-sm space-y-1">
              <li><code>lastName</code> + <code>firstName</code> → joined with space</li>
              <li><code>fullName</code> fallback</li>
              <li>Generic fallback (see below)</li>
            </ol>
          </div>
          <div className="rounded-md border p-4 dark:border-neutral-700">
            <h4 className="mb-2 text-sm font-semibold text-blue-700 dark:text-blue-400">Company (insuredType = &quot;company&quot;)</h4>
            <ol className="list-decimal pl-5 text-sm space-y-1">
              <li><code>companyName</code></li>
              <li><code>organisationName</code></li>
              <li>Generic fallback (see below)</li>
            </ol>
          </div>
          <div className="rounded-md border p-4 sm:col-span-2 dark:border-neutral-700">
            <h4 className="mb-2 text-sm font-semibold">Generic Fallback (unknown type)</h4>
            <ol className="list-decimal pl-5 text-sm space-y-1">
              <li><code>companyName</code> → <code>organisationName</code> → <code>fullName</code></li>
              <li><code>lastName</code> + <code>firstName</code></li>
            </ol>
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock
        title="Primary ID Resolution"
        description="How the primary identifier is extracted based on insured type."
      >
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Insured Type</th>
                <th className="px-3 py-2 text-left font-medium">Primary ID Key</th>
                <th className="px-3 py-2 text-left font-medium">Fallback</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700">
              <tr>
                <td className="px-3 py-2">personal</td>
                <td className="px-3 py-2 font-mono text-xs">idNumber</td>
                <td className="px-3 py-2 text-xs text-neutral-500">—</td>
              </tr>
              <tr>
                <td className="px-3 py-2">company</td>
                <td className="px-3 py-2 font-mono text-xs">brNumber</td>
                <td className="px-3 py-2 text-xs text-neutral-500">—</td>
              </tr>
              <tr>
                <td className="px-3 py-2 italic text-neutral-500">unknown</td>
                <td className="px-3 py-2 font-mono text-xs">idNumber</td>
                <td className="px-3 py-2 font-mono text-xs">brNumber</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SettingsBlock>

      <SettingsBlock
        title="Address Building"
        description="How fullAddress is constructed from individual fields."
      >
        <div className="rounded-md border p-4 dark:border-neutral-700">
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-300">
            Fields are resolved in order and joined with commas. Each field uses <code>firstNonEmpty</code> across its aliases:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-800">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Part</th>
                  <th className="px-3 py-1.5 text-left font-medium">Key Aliases</th>
                  <th className="px-3 py-1.5 text-left font-medium">Format</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-neutral-700 text-xs">
                {[
                  { part: "Flat", aliases: "flatNumber, flatNo, flat", fmt: "Flat {value}" },
                  { part: "Floor", aliases: "floorNumber, floorNo, floor, foorNo", fmt: "{value}/F" },
                  { part: "Block", aliases: "blockNumber/blockNo + blockName/block", fmt: "{num} {name}" },
                  { part: "Street", aliases: "streetNumber/streetNo + streetName/street", fmt: "{num} {name}" },
                  { part: "Property", aliases: "propertyName, property", fmt: "Title Case" },
                  { part: "District", aliases: "districtName, district", fmt: "Title Case" },
                  { part: "Area", aliases: "area, region", fmt: "Title Case" },
                ].map((r) => (
                  <tr key={r.part}>
                    <td className="px-3 py-1.5 font-medium">{r.part}</td>
                    <td className="px-3 py-1.5 font-mono text-neutral-500 dark:text-neutral-400">{r.aliases}</td>
                    <td className="px-3 py-1.5">{r.fmt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded bg-neutral-100 px-3 py-2 font-mono text-xs dark:bg-neutral-800">
            Result: Flat 12A, 3/F, Block B Tower 1, 88 Nathan Road, Tsim Sha Tsui, Kowloon
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock
        title="Format Types"
        description="How resolved values are formatted for display."
      >
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Format</th>
                <th className="px-3 py-2 text-left font-medium">Behaviour</th>
                <th className="px-3 py-2 text-left font-medium">Example</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700">
              <tr>
                <td className="px-3 py-2 font-mono text-xs">currency</td>
                <td className="px-3 py-2">Intl.NumberFormat with currency code (default HKD). Handles multi-line values.</td>
                <td className="px-3 py-2 font-mono text-xs">1234.5 → HK$1,234.50</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs">negative_currency</td>
                <td className="px-3 py-2">Same as currency (sign preserved by number)</td>
                <td className="px-3 py-2 font-mono text-xs">-500 → -HK$500.00</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs">date</td>
                <td className="px-3 py-2">Parsed as Date, formatted DD/MM/YYYY</td>
                <td className="px-3 py-2 font-mono text-xs">2024-03-15 → 15/03/2024</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs">boolean</td>
                <td className="px-3 py-2">true/&quot;true&quot; → &quot;Yes&quot;, everything else → &quot;No&quot;</td>
                <td className="px-3 py-2 font-mono text-xs">true → Yes</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs">number</td>
                <td className="px-3 py-2">toLocaleString() for thousands separators</td>
                <td className="px-3 py-2 font-mono text-xs">1234567 → 1,234,567</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs italic text-neutral-500">(none)</td>
                <td className="px-3 py-2">String(value).trim()</td>
                <td className="px-3 py-2 font-mono text-xs">as-is</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SettingsBlock>

      <SettingsBlock
        title="Accounting Sum Keys"
        description="These field keys are automatically summed across all accounting lines when lineKey = 'total'."
      >
        <div className="flex flex-wrap gap-2">
          {["grossPremium", "netPremium", "clientPremium", "agentCommission", "creditPremium", "levy", "stampDuty", "discount", "margin"].map((k) => (
            <span key={k} className="rounded-full bg-blue-100 px-3 py-1 text-xs font-mono dark:bg-blue-900 dark:text-blue-200">
              {k}
            </span>
          ))}
        </div>
      </SettingsBlock>

      <SettingsBlock
        title="Statement Dynamic Fields"
        description="Fields starting with item_ resolve per-line premium values from statement items."
      >
        <div className="rounded-md border p-4 dark:border-neutral-700">
          <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-2">
            Pattern: <code className="bg-neutral-100 px-1 rounded dark:bg-neutral-800">item_&#123;premiumKey&#125;</code> →
            extracts <code>premiums[premiumKey]</code> from each active statement item, joined by newlines.
          </p>
          <div className="rounded bg-neutral-100 px-3 py-2 font-mono text-xs dark:bg-neutral-800">
            <div>item_clientPremium → &quot;1200.00\n800.00\n350.00&quot;</div>
            <div className="text-neutral-500">// one value per active statement line item</div>
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock
        title="Consumer Files"
        description="Files that import from lib/field-resolver.ts — if you see a bug, check these."
      >
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">File</th>
                <th className="px-3 py-2 text-left font-medium">What It Uses</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700 text-xs">
              {[
                { file: "components/policies/tabs/DocumentsTab.tsx", uses: "resolveRawValue, formatResolvedValue, SnapshotData, ResolveContext, FieldRef" },
                { file: "lib/pdf/resolve-data.ts", uses: "resolveAndFormat, SnapshotData, AccountingLineCtx, InvoiceCtx, StatementCtx, ResolveContext" },
                { file: "lib/pdf/build-context.ts", uses: "getDisplayNameFromSnapshot" },
                { file: "components/policies/PackageBlock.tsx", uses: "getInsuredDisplayName, getInsuredType" },
                { file: "components/policies/PoliciesTableClient.tsx", uses: "getDisplayNameFromSnapshot" },
                { file: "components/policies/PolicySnapshotView.tsx", uses: "formatResolvedValue" },
                { file: "app/api/policies/[id]/premiums/route.ts", uses: "getDisplayNameFromSnapshot" },
                { file: "app/api/accounting/invoices/[id]/route.ts", uses: "getDisplayNameFromSnapshot" },
                { file: "app/api/policies/[id]/linked-insurers/route.ts", uses: "getDisplayNameFromSnapshot" },
                { file: "app/api/admin/organisations/route.ts", uses: "getDisplayNameFromSnapshot" },
                { file: "app/api/premium-entity-options/route.ts", uses: "getDisplayNameFromSnapshot" },
                { file: "app/(dashboard)/dashboard/flows/[flow]/page.tsx", uses: "getDisplayNameFromSnapshot" },
                { file: "app/api/admin/users/[id]/link-client/route.ts", uses: "getInsuredDisplayName, getInsuredType, getInsuredPrimaryId, getContactField" },
                { file: "app/api/admin/users/route.ts", uses: "getInsuredDisplayName, getInsuredType, getInsuredPrimaryId, getContactField" },
                { file: "app/api/admin/unlinked-clients/route.ts", uses: "getInsuredDisplayName, getInsuredType, getInsuredPrimaryId" },
                { file: "components/account/ClientProfileWizard.tsx", uses: "getInsuredDisplayName, getInsuredType, getInsuredPrimaryId, getContactField" },
              ].map((r) => (
                <tr key={r.file}>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{r.file}</td>
                  <td className="px-3 py-2 text-neutral-500 dark:text-neutral-400">{r.uses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsBlock>
    </main>
  );
}
