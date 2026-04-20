---
name: compact
description: Cleans up throwaway / scratch files left behind by past agent sessions in this repo (scripts/tmp-* files, ad-hoc migration scripts, stray .bak/.orig backups, debug HTML, scratch directories). Always previews and asks before deleting. Use ONLY when the user explicitly says "compact", "/compact", "clean up tmp", "clean up files", "remove temp files", "tidy scripts", or similar. Never run proactively.
---

# Compact

Removes one-shot debug / scratch artifacts that accumulate in this repo over time. Source-of-truth code is never touched.

## When to invoke

Run this skill ONLY when the user explicitly asks. Trigger phrases:

- `/compact`
- "compact", "compact the repo"
- "clean up tmp scripts", "clean up temp files"
- "tidy up", "tidy scripts"
- "remove the temp/scratch files"

Never run as part of another task or on commit. The user is in charge of when this happens.

## Workflow

Follow these four steps in order. Stop at step 3 and wait for the user's response.

```
- [ ] 1. Scan for candidate files using the catalog below
- [ ] 2. Print a preview grouped by category (path + size + brief reason)
- [ ] 3. Ask the user to confirm — show counts and let them deselect
- [ ] 4. Delete confirmed files using the Delete tool, then print a summary
```

### Step 1 — Scan

Use the `Glob` tool (NOT shell `find`) to scan each pattern from the catalog. Run all globs in parallel in a single tool batch.

### Step 2 — Preview

Print a single grouped list. Use this format so the user can scan it quickly:

```
Found N candidate files (~M KB total):

scripts/ tmp-* (3 files, 4.2 KB)
  scripts/tmp-fix-agent-credit-advice-amount.js     (1.1 KB)
  scripts/tmp-inspect-agent-credit-advice.js        (2.3 KB)
  scripts/tmp-seed-agent-statuses.js                (0.8 KB)

Stray backups (1 file, 0.3 KB)
  lib/format/date.ts.bak                            (0.3 KB)

(no other categories matched)
```

If zero candidates: tell the user, then stop. Don't invent work.

### Step 3 — Confirm

Use `AskQuestion` with one multi-select prompt listing the categories. Default-select every category EXCEPT "Uncertain" (see catalog).

Wait for the answer before any deletion.

### Step 4 — Delete + summarise

Delete the user-approved files using the `Delete` tool (one call per file — never `rm -rf`). Print a final one-line summary: `Deleted N files (~M KB).`

## Pattern catalog

Each entry: `glob → category → reason`. Run every glob; group results by category in the preview.

### Always safe (default-select)

| Glob | Category | Reason |
|------|----------|--------|
| `scripts/tmp-*` | `scripts/ tmp-*` | Project convention for one-shot debug scripts |
| `scripts/temp-*` | `scripts/ tmp-*` | Same convention, alt spelling |
| `scripts/scratch-*` | `scripts/ tmp-*` | Same convention, alt spelling |
| `**/*.bak` | Stray backups | Editor / migration backups |
| `**/*.orig` | Stray backups | Merge-conflict leftovers |
| `**/*.rej` | Stray backups | Patch-reject leftovers |
| `**/*~` | Stray backups | Emacs / nano backups |
| `**/.DS_Store` | OS junk | macOS metadata |
| `**/Thumbs.db` | OS junk | Windows thumbnail cache |
| `scratch/**` | Scratch dirs | Conventional scratch directory |
| `.scratch/**` | Scratch dirs | Hidden scratch directory |
| `playground/**` | Scratch dirs | Conventional playground directory |
| `tmp/**` | Scratch dirs | Top-level tmp directory |

### Uncertain (do NOT default-select; mention but require explicit user opt-in)

| Glob | Category | Reason |
|------|----------|--------|
| `**/test-*.html` | Debug HTML | Often legitimate fixtures — verify with user |
| `**/debug-*.{js,ts,mjs}` | Debug scripts | Could be a real dev tool — ask first |
| `**/*.tmp` | Temp files | Some build tools generate `.tmp` legitimately |

### Never delete (skip even if matched by other rules)

Hard exclude these paths — never include in the preview:

- `node_modules/**`
- `.next/**`, `dist/**`, `build/**`, `.turbo/**`, `coverage/**`
- `.git/**`
- `.env*` (secrets)
- Anything under `db/migrations/**` (drizzle migration history)
- Anything under `.cursor/**`, `.agents/**`, `mcps/**` (agent infrastructure)

## Anti-patterns to avoid

- Don't run shell `find` / `rm` / `del` — use `Glob` to scan and `Delete` to remove (one call per file). Keeps deletion auditable.
- Don't delete without showing a preview first, even if "obvious".
- Don't recurse into `node_modules` or build output. Glob with the catalog patterns; don't expand.
- Don't proactively suggest running this. Wait for explicit ask.
- Don't `git add` or commit the cleanup unless the user explicitly asks.
- Don't recreate files you just deleted ("oops" rebuilds). If unsure whether something is needed, leave it.

## Example session

```
User: /compact

Agent: [Scans using catalog globs in parallel]

Found 4 candidate files (~4.5 KB total):

scripts/ tmp-* (3 files, 4.2 KB)
  scripts/tmp-fix-agent-credit-advice-amount.js     (1.1 KB)
  scripts/tmp-inspect-agent-credit-advice.js        (2.3 KB)
  scripts/tmp-seed-agent-statuses.js                (0.8 KB)

Stray backups (1 file, 0.3 KB)
  lib/format/date.ts.bak                            (0.3 KB)

[Asks: "Delete which categories?" with both pre-selected]

User: [confirms both]

Agent: [Calls Delete tool for each of the 4 files]

Deleted 4 files (~4.5 KB).
```

## Notes for the agent

- The "Always safe" catalog is calibrated to THIS repo's conventions (Next.js + Drizzle). When extending, prefer adding patterns to the catalog over hard-coding lists.
- If the user asks to compact a sub-directory only (e.g. "compact the scripts folder"), restrict every glob to that prefix.
- File sizes in the preview can be approximate (read first 4KB, or skip size if unavailable).
