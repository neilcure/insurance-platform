### Branching and linkage rules (MUST use package field keys)

This project MUST drive all branching/linkage logic from package field keys (and optional row meta), NEVER from display labels or free text.

- Important: Do not substring-match labels like "existing/new". Labels change; keys are the contract.
- Prefer explicit meta on step rows, e.g. `meta.branch = "existing" | "new" | "create"`.
- When meta is absent, read the configured package field key/value that represents the choice.

### Canonical keys and values

- Preferred field key for Step 1 choice: `existOrCreateClient`
  - Values:
    - `chooseClient` → Existing client path
    - `createNClient` (or any value containing "create" or "new") → Create-new path
- Acceptable alternative keys (normalize by removing non-letters):
  - `newExistingClient`, `newOrExistingClient`, `existingOrNewClient`

### Implementation requirements

- Create a single helper that:
  - Normalizes keys/values (lowercase, strip non-letters) and maps to `"existing"` or `"create"`.
  - Checks explicit row `meta.branch`/`meta.branchType`/`meta.mode` first.
  - Falls back to field-key based detection (as above).
- All step navigation MUST call this helper; do not duplicate logic.
- Never open dialogs or perform API calls based on label text.

### Reviewer checklist (PRs touching flows/steps)

- [ ] Uses field key/meta-driven detection via the shared helper
- [ ] Handles `existOrCreateClient` and aliases as above
- [ ] No label-based substring logic remains
- [ ] Includes a manual test using `app/dev/branch-test` or equivalent
- [ ] Maintains behavior: Existing → open picker; Create → advance to next step

### Manual test

1. Configure Step 1 field `existOrCreateClient` with options `chooseClient` and `createNClient`.
2. In `/policies/new`:
   - Select “Existing” → Continue should open the client picker (unless a `clientId` is already set).
   - Select “Create New” → Continue should advance to Step 2 without prompts or API calls.

