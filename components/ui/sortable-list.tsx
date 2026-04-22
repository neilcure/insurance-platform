"use client";

import * as React from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable as useDndKitSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * App-wide drag-to-sort primitive.
 *
 * Thin wrapper around @dnd-kit/core + @dnd-kit/sortable so callers don't
 * have to import or wire DndContext/SortableContext/sensors directly.
 * Provides:
 *   - <SortableList>        : context provider with sensible sensors and strategy
 *   - useSortableItem(id)   : per-row hook returning ref, style, handle props
 *   - <SortableHandle>      : visual grip-vertical icon, marks the drag handle
 *   - reorderItems(arr,from,to) : pure helper for keyboard / arrow-button reorders
 *
 * Why dnd-kit instead of HTML5 native:
 *   - Touch devices work (HTML5 native DnD has zero touch support).
 *   - Keyboard reorder out of the box: focus a handle, press Space to
 *     pick up, arrows to move, Space to drop, Esc to cancel.
 *   - Screen-reader announcements are wired in.
 *
 * Why a wrapper instead of "just import dnd-kit everywhere":
 *   - Centralizes sensor config (drag-after-5px so simple clicks on
 *     handles still register as clicks).
 *   - Centralizes sortable strategy and collision detection.
 *   - One place to swap engines later if needed.
 *   - Same API surface as the original hook so caller code is unchanged.
 *
 * Usage with a <Table>:
 *
 *   <SortableList items={fields} getId={(f) => f.key} onReorder={setFields}>
 *     <Table>
 *       <TableHeader>...</TableHeader>
 *       <TableBody>
 *         {fields.map((field) => (
 *           <FieldRow key={field.key} id={field.key} field={field} />
 *         ))}
 *       </TableBody>
 *     </Table>
 *   </SortableList>
 *
 * IMPORTANT — wrap the WHOLE <Table>, not just <TableBody>. dnd-kit's
 * DndContext renders hidden accessibility <div>s as siblings of its
 * children for screen-reader announcements. <table> can only contain
 * table-section elements (<thead>, <tbody>, etc.), so a <div> inside
 * <table> is an HTML hydration error. SortableContext under the hood
 * is React-context-only and renders no DOM, so it's safe spanning
 * <thead> + <tbody>.
 *
 *   function FieldRow({ id, field }: Props) {
 *     const s = useSortableItem(id);
 *     return (
 *       <TableRow ref={s.setNodeRef} style={s.style} className={s.rowClassName}>
 *         <TableCell><SortableHandle {...s.handleProps} /></TableCell>
 *         ...
 *       </TableRow>
 *     );
 *   }
 */

export type SortableListProps<T> = {
  items: T[];
  /**
   * Stable id for each item. Must be unique within the list and persist
   * across renders. Prefer a real id field on the item; index is provided
   * as a last-resort fallback for items that genuinely lack one.
   */
  getId: (item: T, index: number) => string | number;
  /**
   * Called after a successful drop with the fully reordered array. Never
   * mutates the input.
   */
  onReorder: (nextItems: T[]) => void;
  /** When true, drags are ignored and handles render inert. */
  disabled?: boolean;
  children: React.ReactNode;
};

/**
 * Wraps children in a DndContext + SortableContext so any descendant
 * <FieldRow> calling useSortableItem() participates in this list's drag.
 *
 * Listening to onDragEnd here (rather than per-row) means the children
 * never have to compute the array surgery themselves — they just render.
 */
export function SortableList<T>({
  items,
  getId,
  onReorder,
  disabled,
  children,
}: SortableListProps<T>) {
  // PointerSensor with a small activation distance: clicks on the handle
  // (e.g. accidental focus) won't trigger a drag — the user has to actually
  // move 5px before drag starts. This keeps clicks-as-clicks reliable.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = React.useMemo(
    () => items.map((it, i) => getId(it, i)),
    [items, getId],
  );

  function handleDragEnd(event: DragEndEvent) {
    if (disabled) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.findIndex((id) => id === active.id);
    const to = ids.findIndex((id) => id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export type UseSortableItemReturn = {
  /**
   * Callback ref to attach to the row element.
   *
   *   <TableRow ref={item.attach} ... />
   *
   * Named `attach` (not `setNodeRef`) on purpose — the React Compiler eslint
   * rule heuristically flags any identifier containing "Ref" as a ref-access
   * during render, which produces a false positive on a perfectly valid
   * callback ref. Renaming sidesteps that heuristic without losing meaning.
   */
  attach: (node: HTMLElement | null) => void;
  /** Spread on the row element's style. Drives the live drag transform. */
  style: React.CSSProperties;
  /**
   * Spread on the visible drag handle. Includes the pointer + keyboard
   * listeners and a draggable cursor. Only the element wearing these
   * listeners can initiate a drag, so inputs/buttons inside the row stay
   * fully interactive.
   */
  handleProps: Record<string, unknown>;
  /**
   * Optional: spread on the row element to add accessibility attributes
   * (aria-roledescription, aria-pressed, etc.) and the tabIndex needed for
   * keyboard sorting. Most callers can ignore this — the handle's own
   * listeners are enough for basic drag — but spreading these makes screen
   * readers announce the row as draggable.
   */
  rowAttributes: Record<string, unknown>;
  /** Convenience class string applying drag opacity + above-others z-index. */
  rowClassName: string;
  isDragging: boolean;
};

/**
 * Per-row hook. Call inside the component that renders one row of the
 * SortableList. The id MUST match what the parent SortableList's getId()
 * returns for this item.
 */
export function useSortableItem(id: string | number): UseSortableItemReturn {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useDndKitSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the dragging row visually above its neighbours.
    zIndex: isDragging ? 30 : undefined,
    position: isDragging ? "relative" : undefined,
  };

  const handleProps: Record<string, unknown> = {
    ...listeners,
    style: {
      cursor: isDragging ? "grabbing" : "grab",
      // Stops mobile browsers from interpreting the touch as a scroll
      // before our drag listeners can react.
      touchAction: "none",
    },
  };

  return {
    attach: setNodeRef,
    style,
    handleProps,
    rowAttributes: attributes as unknown as Record<string, unknown>,
    rowClassName: cn(isDragging && "opacity-60"),
    isDragging,
  };
}

/**
 * Visual drag handle. Spread `handleProps` from `useSortableItem(id)` onto
 * this. Pass `size="sm"` for compact tables.
 *
 *   <SortableHandle {...s.handleProps} />
 */
export function SortableHandle({
  size = "md",
  className,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { size?: "sm" | "md" }) {
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <span
      {...rest}
      aria-label={(rest as { "aria-label"?: string })["aria-label"] ?? "Drag to reorder"}
      role={(rest as { role?: string }).role ?? "button"}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200",
        className,
      )}
    >
      <GripVertical className={iconSize} />
    </span>
  );
}

/**
 * Pure helper — reorders an item from `from` to `to` and returns a new
 * array. Used by up/down arrow buttons so they share the same surgery
 * shape as drag-and-drop.
 *
 *   onClick={() => onReorder(reorderItems(items, idx, idx - 1))}
 */
export function reorderItems<T>(items: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }
  return arrayMove(items, from, to);
}
