## Drawer UI Standards

This document defines a single, consistent behavior and look for all slide-over drawers in the app. Follow these rules for any new or existing drawer.

### Purpose

- Ensure all drawers feel identical across pages.
- Prevent regressions caused by mixed implementations (`Dialog` vs. custom containers).

### Standard Behavior

- **Side and direction**: open from the left; close to the left.
- **Width**: `w-[280px] sm:w-[320px] md:w-[380px]`.
- **Overlay**: black backdrop with fade animation.
- **Animation**:
  - Panel: `transform transition-transform duration-300 ease-out will-change-transform` with `translate-x-0` when open and `-translate-x-full` when closed.
  - Overlay: `transition-opacity duration-300`, use `opacity-60` when open and `opacity-0` when closed.
- **Z-index**: container must be `fixed inset-0 z-50`.
- **Close behavior**: clicking the overlay or pressing Escape closes the drawer.

### Preferred Implementation

Use the shared `Drawer` and `DrawerContent` from `components/ui/drawer.tsx`. Control the open/close animation by toggling classes on `DrawerContent` and the overlay opacity via `overlayClassName`.

Example (TypeScript/React):

```tsx
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

function ExampleDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setDrawerOpen(false);
      requestAnimationFrame(() => setDrawerOpen(true));
    } else {
      setDrawerOpen(false);
    }
  }, [open]);

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (o) {
          onOpenChange(true);
        } else {
          setDrawerOpen(false);
          // Allow exit animation before unmount
          setTimeout(() => onOpenChange(false), 320);
        }
      }}
      overlayClassName={`transition-opacity duration-300 ${drawerOpen ? "opacity-60" : "opacity-0"}`}
    >
      <DrawerContent
        className={`${drawerOpen ? "translate-x-0" : "-translate-x-full"} w-[280px] sm:w-[320px] md:w-[380px] left-0`}
      >
        <DrawerHeader>
          <DrawerTitle>Title</DrawerTitle>
        </DrawerHeader>
        <div className="p-4">Content here</div>
      </DrawerContent>
    </Drawer>
  );
}
```

### Legacy/Direct Markup (only if necessary)

If you cannot use the shared component (e.g., special constraints), replicate this exact structure/classes:

```tsx
<div className="fixed inset-0 z-50">
  <div
    className={`absolute inset-0 bg-black transition-opacity duration-300 ${open ? "opacity-60" : "opacity-0"}`}
    onClick={onClose}
  />
  <aside
    className={`absolute left-0 top-0 h-full w-[280px] sm:w-[320px] md:w-[380px] bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800 shadow-xl transform transition-transform duration-300 ease-out will-change-transform ${
      open ? "translate-x-0" : "-translate-x-full"
    }`}
  >
    {/* drawer content */}
  </aside>
</div>
```

### Do / Don’t

- Do open from the left, with the exact width and animations above.
- Do use the shared `Drawer` component when possible.
- Do keep a brief delay (~300–320ms) before unmount on close for a smooth exit animation.
- Don’t use `Dialog` for slide-over drawers.
- Don’t change animation durations or easing without updating this document and all usages.

### Data presentation rules (policy/client drawers)

- Always display human-readable labels:
  - Package titles: resolve from `GET /api/form-options?groupKey=packages` (value → label).
  - Field labels: resolve per package from `GET /api/form-options?groupKey=${pkg}_fields` (value → label).
  - Category labels: resolve per package from `GET /api/form-options?groupKey=${pkg}_category`.
- Do not show raw keys when a label is available.
- De-duplicate fields within a package by normalized key (strip leading underscores/non-alphanumerics; case-insensitive).
- Hide branch/choice packages (e.g., `newExistingClient`, `existOrCreateClient`, `chooseClient`) in the policy drawer.
- Always show Insurance Type if available:
  - Prefer `extraAttributes.coverType`.
  - Fallback to `packagesSnapshot.policy.coverType` or `.values.coverType` (accept `cover_type` too).
  - Normalize to "Comprehensive" or "Third Party" where applicable.

### Accessibility

- Escape closes the drawer (handled in `Drawer`).
- The overlay is clickable to close.
- Provide clear `DrawerTitle` text for screen readers.

### Checklist (PR Review)

- Width: `w-[280px] sm:w-[320px] md:w-[380px]`.
- Overlay: `transition-opacity duration-300`, `opacity-60` when open.
- Panel: `transition-transform duration-300 ease-out will-change-transform` with left translate.
- Uses `components/ui/drawer.tsx` or matches the legacy markup exactly.
- Close on overlay click and Escape.

