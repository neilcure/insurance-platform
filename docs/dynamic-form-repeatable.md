## Dynamic Form Repeatable Fields — Working Rules

Use these notes whenever adding/debugging repeatable list fields in the policy wizard.

- What actually renders Step 2
  - The dynamic flow in `app/(dashboard)/policies/new/page.tsx` (component: `PackageBlockMemo`) renders Step 2 fields when a flow is configured.
  - The legacy `components/policies/vehicle-step.tsx` only renders when no flow steps are present. If your flow is active, edits in `VehicleStep` will not affect Step 2.

- Where the data comes from
  - All dynamic fields are stored in DB table `form_options`.
  - Group keys:
    - Vehicle step (package-style): `${pkg}_fields` (e.g., `vehicle_fields`)
    - Categories per package: `${pkg}_category` (e.g., `vehicle_category`)
  - Public read API: `/api/form-options?groupKey=<key>` (returns only `is_active=true` rows).
  - Admin CRUD API: `/api/admin/form-options` and `/api/admin/form-options/:id`.

- Field config shape for a repeatable
  - Minimal example saved in `form_options.meta`:

    ```json
    {
      "inputType": "repeatable",
      "repeatable": {
        "itemLabel": "Accessory",
        "min": 1,
        "max": 4,
        "fields": [
          { "label": "Name", "value": "name", "inputType": "string", "required": true },
          { "label": "Cost", "value": "cost", "inputType": "number" },
          {
            "label": "Type",
            "value": "type",
            "inputType": "select",
            "options": [
              { "label": "Electrical", "value": "electrical" },
              { "label": "Body", "value": "body" }
            ]
          }
        ]
      }
    }
    ```

- Rendering rules in the wizard
  - The Step 2 dynamic renderer supports repeatable when either of these is true:
    - `meta.inputType === "repeatable"` (case/whitespace-insensitive), or
    - `meta.repeatable` exists (failsafe).
  - Child field types supported inside repeatable: `string | number | date | select | multi_select`.
  - Category scoping: if `meta.categories` is non-empty, the field only renders for the selected package category.

- React behavior to avoid errors
  - Do NOT call `form.setValue` (or any state setter) during render. It triggers:
    - “Cannot update a component while rendering a different component”
  - Only update form state in event handlers (Add/Remove buttons) or in effects that run after render.
  - For `min` rows: render the UI for `min` rows without mutating the form state during the render phase. Let user actions populate values.

- Admin UI to edit fields
  - Correct path to manage vehicle fields: `/admin/policy-settings/vehicle/fields`.
  - Ensure the field is `Active`; the public API excludes inactive rows.
  - After saving, verify via the public endpoint:
    - `/api/form-options?groupKey=vehicle_fields`

- Debug checklist
  - Verify the row in `/api/form-options?groupKey=vehicle_fields`:
    - `meta.inputType` equals `"repeatable"` (any casing) OR `meta.repeatable` exists.
    - `meta.repeatable.fields` is a non-empty array.
  - Hard refresh the wizard page (Ctrl+Shift+R).
  - Confirm the correct package/category is selected so category-filtered fields are visible.
  - Watch for key typos: the field `value` must match exactly; typos lead to separate plain inputs (e.g., `accories` vs `accessories`).

- When to edit which file
  - If a flow is configured (normal case), implement field behavior in `app/(dashboard)/policies/new/page.tsx` (`PackageBlockMemo`).
  - Only edit `components/policies/vehicle-step.tsx` if the fallback path (no configured steps) is used.

- Tips
  - Treat `inputType` defensively: lowercase/trim and add a fallback to `meta.repeatable` to be resilient to minor data issues.
  - Keep type-safety; avoid `any` where possible in event handlers and renderer options.

## General Rule for All Dynamic Input Types

- When flows are active, always implement/extend renderers in `app/(dashboard)/policies/new/page.tsx` (`PackageBlockMemo`). The legacy `VehicleStep` is only a fallback when there are no configured steps.
- Each new `inputType` must have:
  - A renderer branch in `PackageBlockMemo` (case-insensitive check, plus any necessary meta fallbacks).
  - Admin support to author its config (update `components/admin/generic/GenericFieldsManager.tsx` and/or `NewPackageFieldClient.tsx` to expose the new type in the UI).
  - Validation and event handlers that do not call `setValue` during render; only in handlers or effects.

### Adding a New Input Type (Recipe)
1) Data model: define the `meta` shape for the new type (e.g., `meta.slider: { min, max, step }`).  
2) Admin: expose the type and its config fields in the admin editor.  
3) Renderer: in `PackageBlockMemo`, add a branch (e.g., `if (inputType === "slider") { ... }`). Normalize via `String(meta.inputType).trim().toLowerCase()`.  
4) Validation: attach `form.register(nameBase, { validate / setValueAs / required })` as needed.  
5) Side effects: never set form state during render; do it inside events or `useEffect`.  
6) Test: create a field in `/admin/policy-settings/<pkg>/fields`, verify via `/api/form-options?groupKey=<pkg>_fields`, hard-refresh Step 2, and confirm rendering.

