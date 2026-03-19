import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

const templates = [
  {
    group_key: "document_templates",
    label: "Motor Insurance Quotation",
    value: "motor_quotation",
    value_type: "json",
    sort_order: 1,
    is_active: true,
    meta: {
      type: "quotation",
      flows: [],
      header: {
        title: "Motor Insurance Quotation",
        subtitle: "Bravo General Interface",
        showDate: true,
        showPolicyNumber: true,
      },
      sections: [
        {
          id: "s1",
          title: "Insured Information",
          source: "insured",
          fields: [
            { key: "lastName", label: "Last Name", format: "text" },
            { key: "firstName", label: "First Name", format: "text" },
            { key: "idNumber", label: "ID Number", format: "text" },
            { key: "hasDrivingLicense", label: "Has Driving License", format: "boolean" },
          ],
        },
        {
          id: "s2",
          title: "Contact Information",
          source: "contactinfo",
          fields: [
            { key: "name", label: "Contact Name", format: "text" },
            { key: "personalTitle", label: "Title", format: "text" },
            { key: "tel", label: "Telephone", format: "text" },
            { key: "mobile", label: "Mobile", format: "text" },
            { key: "streetName", label: "Street", format: "text" },
            { key: "districtName", label: "District", format: "text" },
            { key: "area", label: "Area", format: "text" },
          ],
        },
        {
          id: "s3",
          title: "Vehicle Details",
          source: "package",
          packageName: "vehicleinfo",
          fields: [
            { key: "make", label: "Make", format: "text" },
            { key: "model", label: "Model", format: "text" },
            { key: "year", label: "Year", format: "text" },
            { key: "plateNumber", label: "Plate Number", format: "text" },
            { key: "engineNumber", label: "Engine No.", format: "text" },
            { key: "chassisNumber", label: "Chassis No.", format: "text" },
          ],
        },
        {
          id: "s4",
          title: "Policy Details",
          source: "package",
          packageName: "policyinfo",
          fields: [
            { key: "coverType", label: "Cover Type", format: "text" },
            { key: "premium", label: "Premium", format: "currency", currencyCode: "HKD" },
            { key: "sumInsured", label: "Sum Insured", format: "currency", currencyCode: "HKD" },
            { key: "ncdPercent", label: "NCD %", format: "text" },
            { key: "effectiveDate", label: "Effective Date", format: "date" },
            { key: "expiryDate", label: "Expiry Date", format: "date" },
          ],
        },
        {
          id: "s5",
          title: "Driver Information",
          source: "package",
          packageName: "driver",
          fields: [
            { key: "lastName", label: "Driver Last Name", format: "text" },
            { key: "firstName", label: "Driver First Name", format: "text" },
            { key: "idNumber", label: "Driver ID Number", format: "text" },
          ],
        },
      ],
      footer: {
        text: "This quotation is valid for 30 days from the date of issue. Terms and conditions apply.",
        showSignature: true,
      },
    },
  },
  {
    group_key: "document_templates",
    label: "Simple Receipt",
    value: "simple_receipt",
    value_type: "json",
    sort_order: 2,
    is_active: true,
    meta: {
      type: "receipt",
      flows: [],
      header: {
        title: "Payment Receipt",
        subtitle: "Bravo General Interface",
        showDate: true,
        showPolicyNumber: true,
      },
      sections: [
        {
          id: "r1",
          title: "Client",
          source: "insured",
          fields: [
            { key: "lastName", label: "Last Name", format: "text" },
            { key: "firstName", label: "First Name", format: "text" },
          ],
        },
        {
          id: "r2",
          title: "Payment Details",
          source: "package",
          packageName: "policyinfo",
          fields: [
            { key: "coverType", label: "Cover Type", format: "text" },
            { key: "premium", label: "Amount Paid", format: "currency", currencyCode: "HKD" },
          ],
        },
      ],
      footer: {
        text: "Thank you for your payment.",
        showSignature: false,
      },
    },
  },
];

async function main() {
  for (const tpl of templates) {
    const existing = await sql`
      SELECT id FROM form_options
      WHERE group_key = ${tpl.group_key} AND value = ${tpl.value}
      LIMIT 1
    `;
    if (existing.length > 0) {
      console.log(`${tpl.label}: already exists, skipped`);
      continue;
    }
    await sql`
      INSERT INTO form_options (group_key, label, value, value_type, sort_order, is_active, meta)
      VALUES (${tpl.group_key}, ${tpl.label}, ${tpl.value}, ${tpl.value_type}, ${tpl.sort_order}, ${tpl.is_active}, ${JSON.stringify(tpl.meta)}::jsonb)
    `;
    console.log(`${tpl.label}: created`);
  }
  await sql.end();
  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
