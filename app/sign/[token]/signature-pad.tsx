"use client";

import * as React from "react";

/**
 * Lightweight HTML canvas signature pad. No external dependencies
 * (we deliberately don't pull in `react-signature-pad-wrapper` or
 * similar — this is a single-use feature and keeping the bundle
 * small matters for the public sign page, which is opened by
 * recipients on potentially slow mobile networks).
 *
 * Behaviour:
 *  - Captures pointer events (works for mouse + touch + stylus).
 *  - Strokes are smooth: each segment is drawn with rounded line
 *    caps + joins, and we use the midpoint algorithm so quick
 *    drags don't show as a series of straight diagonals.
 *  - Exposes `clear()` and `getDataUrl()` via a ref so the parent
 *    can submit / reset without lifting drawing state up.
 *  - `onChange(isEmpty)` lets the parent disable the submit button
 *    when nothing has been drawn yet.
 */
export type SignaturePadHandle = {
  clear: () => void;
  getDataUrl: () => string | null;
  isEmpty: () => boolean;
};

export const SignaturePad = React.forwardRef<
  SignaturePadHandle,
  { onChange?: (isEmpty: boolean) => void; className?: string; height?: number }
>(function SignaturePad({ onChange, className, height = 200 }, ref) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawingRef = React.useRef(false);
  const lastPointRef = React.useRef<{ x: number; y: number } | null>(null);
  const isEmptyRef = React.useRef(true);

  // Resize the canvas to match its CSS size at the device pixel
  // ratio so strokes stay crisp on retina/HiDPI displays. Re-runs
  // on resize because mobile orientation changes can flip the
  // available width.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a1a1a";
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  React.useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      isEmptyRef.current = true;
      onChange?.(true);
    },
    getDataUrl: () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      // Trim whitespace so the rendered signature is tight to its
      // bounding box. This makes the inline image in the PDF size
      // predictably regardless of where on the canvas the user
      // happened to draw.
      return trimToContent(canvas);
    },
    isEmpty: () => isEmptyRef.current,
  }));

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointerPos(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const last = lastPointRef.current!;
    const next = pointerPos(e);
    const mid = { x: (last.x + next.x) / 2, y: (last.y + next.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    // Quadratic curve via midpoint algorithm — gives a much
    // smoother stroke than a series of `lineTo` segments.
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.stroke();
    lastPointRef.current = next;
    if (isEmptyRef.current) {
      isEmptyRef.current = false;
      onChange?.(false);
    }
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: "100%",
        height,
        touchAction: "none",
        background: "#ffffff",
        borderRadius: 6,
        cursor: "crosshair",
      }}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
    />
  );
});

/**
 * Crop a canvas to the bounding box of its non-transparent pixels
 * and return the result as a PNG data URL. If the canvas is empty
 * we return null so callers can decide whether to skip submission.
 */
function trimToContent(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = imgData[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  // A small padding so the bottom of descenders ('y', 'g', etc.)
  // doesn't collide with the signature line in the PDF.
  const pad = 6;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(width - sx, maxX - minX + pad * 2);
  const sh = Math.min(height - sy, maxY - minY + pad * 2);
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d")?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL("image/png");
}
