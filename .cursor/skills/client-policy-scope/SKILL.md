---
name: client-policy-scope
description: Handles direct-client policy list scope, linked endorsement lookup, client master records vs policy records, and drawer/document bugs where one client's policies appear to share documents or endorsements. Use when editing app/api/policies/route.ts GET, /api/policies?linkedPolicyId=..., PoliciesTableClient, WorkflowTab linkedEndorsements, ClientLinkedPolicies, or debugging "client sees wrong policy/document/endorsement".
---

# Client Policy Scope

This app has two different record concepts that must not be mixed:

- **Client master record**: a `clientSet` / `clients` identity such as `clientPolicyId` or `clientPolicyNumber`.
- **Policy record**: a `policyset` / endorsement row in `policies`, opened by `policyId`.

Two policies for the same insured can legitimately share the same client master snapshot while having different policy numbers, vehicles, premiums, documents, and endorsements.

## Critical Rule

For `direct_client`, `/api/policies` and `/api/policies?linkedPolicyId=<parent>` are different scopes:

- Plain `/api/policies`: return the client's own main `policyset` records.
- `/api/policies?linkedPolicyId=<parent>`: return only endorsement rows where `cars.extraAttributes.linkedPolicyId === parent`, after verifying the parent policy belongs to the client.

Never let the linked-policy path fall back to "all policies for this client". The drawer will treat those rows as endorsements and every policy will appear to share the same documents.

## Required Pattern

When `user.userType === "direct_client"` in `app/api/policies/route.ts`:

1. If `linkedPolicyId` is present, join the parent policy by that ID.
2. Verify the parent policy is owned by the direct client's linked `clients` row.
3. Return only rows whose snapshot `linkedPolicyId` equals the parent ID.
4. If `linkedPolicyId` is absent, run the normal client policy list query.

Do not apply the normal client policy list query to linked endorsement requests.

## Verification

For a client with two main policies where only one has endorsements:

```text
/api/policies                         -> both main policies
/api/policies?linkedPolicyId=<has>    -> only that parent's endorsements
/api/policies?linkedPolicyId=<none>   -> []
```

Then open both policies as `direct_client`:

- The policy with endorsements shows its endorsement documents.
- The policy without endorsements does not show endorsement document groups.
- Both may still show the same insured name/address if they share the same client master snapshot.

## Common Pitfall

Seeing the same insured/client details in two policies is not automatically a bug. Seeing the same endorsement groups or same policy-specific document numbers under unrelated policies is a bug.
