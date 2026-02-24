## Client ID Resolution & Display Rules

This document defines how the app resolves and displays the Client ID for a policy in read-only views (e.g., Policy Details drawer).

### Goals

- Always show a “Client ID” row.
- Prefer the canonical client number (e.g., `HIDIC000081`). If only a numeric `clientId` is known, show `#<id>` until we can resolve the client number.
- Never block rendering; fall back gracefully to “N/A” when no reliable identifier exists.

### Data Sources (in priority order)

1. API-resolved client on policy details
   - Path: `GET /api/policies/:id`
   - Field: `client: { id: number; clientNumber: string; createdAt?: string }`
   - If present, display `client.clientNumber`.

2. Snapshot numeric clientId
   - Path: `detail.extraAttributes.clientId`
   - If present, try `GET /api/clients/:id` to resolve `clientNumber`. While loading, display `#<id>`.

3. Snapshot values in packages (policy package first, then all)
   - Path candidates inside `detail.extraAttributes.packagesSnapshot`:
     - `policy.values.clientId`, `policy.clientId`
     - Variants: `client_id`, `clientID`, `ClientID`
   - If a numeric ID is found, behave like step 2.
   - If a client number is found, use it directly.
   - Number variants for client number: `clientNumber`, `client_no`, `clientNo`, `ClientNumber`, `ClientNo`.

4. Infer from insured identity when no clientId/number exists
   - Build an identity from the snapshot to match an existing client:
     - Company keys (any): `companyName`, `organisationName`, `orgName`, plus an ID like `brNumber`, `businessReg`, `brNo`, `registrationNumber`, or `ciNumber`/`ci`.
     - Personal keys (any): `fullName` or `firstName`+`lastName`, plus `idNumber`/`hkid`.
   - Once the minimal identity is found, search `GET /api/clients` and match by:
     - `category` (`company` or `personal`) and `primaryId` (BR/CI for company; HKID for personal)
   - If a client is found, display `client.clientNumber`.

### Display Format

- Label: “Client ID”
- Preferred value: canonical client number (e.g., `HIDIC000081`).
- Fallback value: numeric ID as `#<id>`.
- Missing value: `N/A`.

### “New User” Badge

- When the details API provides `client.createdAt`, compute recency against the policy creation time:
  - “New User” if `0 ≤ (policy.createdAt - client.createdAt) ≤ 5 minutes`.
  - Otherwise, no badge.

### Example Response (policy details)

```json
{
  "policyId": 123,
  "policyNumber": "POL-1768920718801",
  "createdAt": "2026-01-20T03:11:00.000Z",
  "extraAttributes": {
    "clientId": 81,
    "packagesSnapshot": {
      "policy": {
        "values": {
          "coverType": "comprehensive",
          "clientId": 81
        }
      }
    }
  },
  "client": {
    "id": 81,
    "clientNumber": "HIDIC000081",
    "createdAt": "2026-01-20T03:08:30.000Z"
  }
}
```

### UI Behavior Summary

- **Primary**: show `detail.client.clientNumber`.
- **If absent**: try `extraAttributes.clientId` → fetch client → show number, else show `#<id>`.
- **If still absent**: scan `packagesSnapshot` for `clientId`/`clientNumber` (with variants).
- **If still absent**: infer identity from insured fields → match `/api/clients` by `category + primaryId`.
- **If all fail**: show `N/A`.

### Do / Don’t

- **Do** prefer canonical client numbers over numeric IDs.
- **Do** keep rendering non-blocking; never hide the “Client ID” row.
- **Don’t** assume specific casing for keys; support common variants listed above.
- **Don’t** display partial PII beyond what’s required (client number or `#<id>`).

### Testing Checklist

- Policy with linked clientId → shows client number.
- Policy with only `packagesSnapshot.policy.values.clientId` → resolves to client number.
- Policy with only `packagesSnapshot.policy.values.clientNumber` → shows client number.
- Policy with insured identity but no clientId/number → resolves via `/api/clients`.
- Policy with no resolvable identity → shows `N/A`.

