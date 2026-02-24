# API and Schema Field Prefixing for Dynamic Packages

This app builds forms dynamically from package configurations (e.g. `insured`, `contactinfo`, `vehicleinfo`). To keep request/response payloads stable and avoid collisions across packages, all dynamic fields MUST be namespaced using a “package-name + underscore” prefix.

## Rule (MUST)

- Frontend field keys derived from dynamic packages MUST be prefixed as:
  - `${packageName}_${fieldKey}` (preferred)
  - `${packageName}__${fieldKey}` (legacy, still accepted)

Examples:

- `insured_companyname`, `insured_brnumber`, `insured_cinumber`
- `contactinfo_tel`, `contactinfo_email`
- `vehicleinfo_plateno`, `vehicleinfo_year`

Notes:

- Use lowercase ASCII for prefixes and keys; spaces and punctuation in UI labels are not used in keys.
- Send only filled (non-empty) fields in requests.

## Server Normalization (MUST)

All API endpoints that accept dynamic fields MUST normalize incoming payloads before business logic. Normalization includes:

1. Flatten one level of nesting if the client groups fields under an object.
2. Strip known prefixes: remove `${package}_` and `${package}__` from keys for matching.
3. Canonicalize keys for matching by:
   - Lowercasing
   - Removing non-alphanumeric characters
4. Token-based matching is allowed to absorb variations. For example:
   - Company name: `companyname`, `organisationname`, `orgname`, `company`
   - BR number: `brnumber`, `businessreg`, `brno`, `registrationnumber`
   - CI number: `cinumber`, `ci`
   - Personal name: `fullname`, or `lastname` + `firstname`
   - Personal ID: `idnumber`, `hkid`, `id`
   - Phone: `contactphone`, `phone`, `mobile`

The server SHOULD accept any of the above token variants, and MUST NOT reject if optional fields are missing. Where needed, the server MAY auto-generate a primary identifier (e.g. `AUTO-<timestamp>`) to allow record creation to proceed.

## Canonical Keys (SHOULD)

- Internally, normalize to canonical keys without prefixes (e.g. `companyName`, `brNumber`, `ciNumber`, `fullName`, `idNumber`, `contactPhone`).
- Keep the original, user-submitted values in snapshots (`extraAttributes` or `packagesSnapshot`) to preserve traceability.

## Requests (SHOULD)

- Step actions that create entities (e.g. “Create Client”) SHOULD send the minimal required prefixed fields only.
  - Company: `insured_companyname` + (`insured_brnumber` or `insured_cinumber`)
  - Personal: (`insured_fullname` OR `insured_lastname` + `insured_firstname`) + `insured_idnumber`
- Other packages follow the same `${package}_${field}` convention.

## Responses (MAY)

- Response payloads MAY return canonical (unprefixed) keys for the entity created (e.g. `{ clientId, clientNumber }`), while any snapshots in the response SHOULD retain the original prefixed keys.

## Error Handling (MUST)

- Return clear, minimal messages (e.g. `Invalid insured data`) only when truly insufficient. Prefer best‑effort normalization to avoid blocking creation for benign naming differences.

## Backward Compatibility

- Continue to accept legacy double-underscore `${package}__${field}` prefixes.
- Continue to accept common legacy variants for key matching via tokens (see above).

## Testing Checklist

- [ ] Company flow: `insured_companyname` + `insured_brnumber` → success
- [ ] Company flow: `insured_companyname` + `insured_cinumber` (no BR) → success
- [ ] Personal flow: `insured_lastname` + `insured_firstname` + `insured_idnumber` → success
- [ ] Mixed casing / extra underscores (e.g. `Insured__CompanyName`) → success
- [ ] Nested object one level deep (e.g. `{ insured: { insured_companyname: ... } }`) → success
- [ ] Empty fields are not sent; server does not fail due to empty keys

## Rationale

Dynamic forms can change frequently (labels, groups, and field names). Prefixing fields with the package name prevents collisions and keeps APIs stable while the server normalizes inputs to canonical fields. This approach lets us evolve the UI without breaking server behavior, and keeps snapshots faithful to what the user entered.

## Read-only UI Display Rules (MUST)

To avoid duplicate rows in read-only views (e.g. Policy Details), when rendering package values:

- Deduplicate keys that normalize to the same field:
  - Normalization: remove `${package}_` / `${package}__` prefixes, lowercase, and strip non‑alphanumeric.
  - Example: `insured_companyname`, `insured__Company_Name`, and `Company Name` are treated as one field.
- Prefer the first occurrence after sorting; hide later duplicates.
- Sorting order before deduplication:
  1. Group order (admin configured)
  2. Group name (alphabetical)
  3. Field sort order (admin configured)
  4. Field label (alphabetical, case-insensitive)
- Preserve configured labels and option labels when displaying.
- Repeatable arrays (e.g. accessories lists) should be shown as human-readable rows rather than raw JSON.

## Client Selection & Insured Type Sync (MUST)

When the user selects an existing client in Step 1:

- Do NOT show a confirmation dialog when `insuredType` changes programmatically to match the client’s category; no data is cleared.
- Implement via a suppression flag on the form (e.g. `_suppressInsuredTypeConfirm = true`) during programmatic updates; clear it immediately after.
- Auto-fill any matching `insured_*` / `contactinfo_*` fields from the client’s snapshot; also set reasonable unprefixed aliases where present.
- Set `policy.clientId` and proceed to the next step without attempting client creation.
- Branching flows: if “Existing Client” is chosen, opening the client picker is the only action; do not validate/create a client on Continue until a `clientId` exists.

