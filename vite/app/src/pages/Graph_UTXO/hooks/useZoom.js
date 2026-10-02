// -----------------------------------------------------------
//  [*] Graph_UTXO — useZoom
//
//  The zoom of the UTXO graph, the way the EVM graph zooms:
//  the mouse wheel zooms in and out around the cursor, the
//  slider and the + / − buttons around the middle of the view,
//  all clamped to ZOOM_CONFIG's range. A zoom keeps the spot it
//  is anchored on where it was: the canvas re-renders at the
//  new size and, before the browser paints it, the scroller is
//  moved so that same point of the drawing is under the cursor
//  (or the view's middle) again.
//
//  The pinned block-height row (LAYOUT_CONFIG.HEADER_HEIGHT,
//  unscaled) comes first in the scroll flow, so the drawing
//  starts that much lower; every scroll computed here counts
//  it in. The drawing then floats in whitespace: a MARGIN one
//  view wide on either side and one view tall above and
//  below. Any point of the drawing can then be scrolled under
//  any spot of the view, so a zoom can always keep its anchor
//  — zoomed out, the drawing is not stuck in the top-left
//  corner but shrinks towards the cursor — and a pan can put
//  it anywhere, as in the EVM graph. The margin follows the
//  view's size; when it changes (the first measurement, a
//  window resize) the scroll shifts by the same amount, so the
//  drawing stays where it was on screen — and the first
//  measurement lands its top-left corner at the view's
//  top-left, under the pinned row.
//
//  The wheel needs a NATIVE listener: React attaches its wheel
//  handlers as passive, and a passive listener cannot stop the
//  page from scrolling instead of zooming. A mostly sideways
//  gesture (a trackpad swipe) is not a zoom — it is left to
//  scroll the canvas natively.
//
//  Split into (root last):
//
//    clampScale — a scale forced into the zoom range
//    useZoom    — zoom state, margins, wheel and anchored
//                 scrolling (default export)
// -----------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { LAYOUT_CONFIG, ZOOM_CONFIG } from '../constants';







// -----------------------------------------------------------
// clampScale
// -----------------------------------------------------------
//
// A scale forced into ZOOM_CONFIG's MIN_SCALE..MAX_SCALE —
// the one clamp every zoom path (wheel, slider, buttons)
// passes through.
//
// Used by:
//   - useZoom (below) — every zoom path
// -----------------------------------------------------------

const clampScale = (value) => Math.min(ZOOM_CONFIG.MAX_SCALE, Math.max(ZOOM_CONFIG.MIN_SCALE, value));







// -----------------------------------------------------------
// useZoom (default export)
// -----------------------------------------------------------
//
// The zoom of the canvas and the actions that change it. The
// caller gets `scale` — a length in canvas units times the
// scale is screen pixels — and `margin`, the whitespace in px:
// one view wide left and right of the drawing, one view tall
// above and below it. Then the actions: setZoom zooms to the
// scale it is given, zoomIn and zoomOut move one BUTTON_STEP
// — all three around the view's middle — and goHome scrolls
// the drawing's top-left corner to the view's top-left, just
// under the pinned row. The wheel needs no action: the hook
// listens on the scroller it is handed (the scrolling element
// around the canvas) and zooms around the cursor itself.
//
// Used by:
//   - UtxoFlowGraph.jsx
// -----------------------------------------------------------

export default function useZoom(scrollerRef) {

  const [scale, setScale] = useState(1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // The latest scale for the native wheel listener, the margin
  // the drawing is currently placed with, and the point a zoom
  // must keep in place across its re-render
  const scaleRef = useRef(1);
  const marginRef = useRef({ x: 0, y: 0 });
  const anchorRef = useRef(null);


  // Zoom to `next`, keeping the drawing's point under (cx, cy)
  // — a spot in the scroller's visible area, px — where it is
  const zoomAt = useCallback((next, cx, cy) => {
    const scroller = scrollerRef.current;
    const current = scaleRef.current;
    const clamped = clampScale(next);
    if (!scroller || clamped === current) return;

    anchorRef.current = {
      x: (scroller.scrollLeft + cx - marginRef.current.x) / current,
      y: (scroller.scrollTop + cy - LAYOUT_CONFIG.HEADER_HEIGHT - marginRef.current.y) / current,
      cx,
      cy,
    };
    scaleRef.current = clamped;
    setScale(clamped);
  }, [scrollerRef]);


  // The canvas has re-rendered at the new size: scroll so the
  // anchored point sits under the same spot again, before paint
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller) return;
    anchorRef.current = null;
    scroller.scrollLeft = marginRef.current.x + anchor.x * scale - anchor.cx;
    scroller.scrollTop = LAYOUT_CONFIG.HEADER_HEIGHT + marginRef.current.y + anchor.y * scale - anchor.cy;
  }, [scale, scrollerRef]);


  // The margin is the view's size. When it changes, shift the
  // scroll by the difference so the drawing stays put on screen
  // (from the initial 0, that places its corner at the view's)
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollLeft += viewport.width - marginRef.current.x;
    scroller.scrollTop += viewport.height - marginRef.current.y;
    marginRef.current = { x: viewport.width, y: viewport.height };
  }, [viewport, scrollerRef]);


  // The wheel zooms around the cursor. deltaMode 1 (Firefox's
  // line steps) is turned into pixels first
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    const onWheel = (event) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const rect = scroller.getBoundingClientRect();
      zoomAt(
        scaleRef.current * Math.exp(-pixels * ZOOM_CONFIG.WHEEL_SPEED),
        event.clientX - rect.left - scroller.clientLeft,
        event.clientY - rect.top - scroller.clientTop,
      );
    };

    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [scrollerRef, zoomAt]);


  // The visible area, re-measured whenever the scroller resizes
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    const observer = new ResizeObserver(() => {
      setViewport({ width: scroller.clientWidth, height: scroller.clientHeight });
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollerRef]);


  // Back to the start: the drawing's top-left at the view's,
  // just under the pinned row (which sticks exactly there)
  const goHome = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollLeft = marginRef.current.x;
    scroller.scrollTop = marginRef.current.y;
  }, [scrollerRef]);


  // The slider and the buttons zoom around the view's middle
  const zoomCentered = (next) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    zoomAt(next, scroller.clientWidth / 2, scroller.clientHeight / 2);
  };


  return {
    scale,
    margin: { x: viewport.width, y: viewport.height },
    setZoom: zoomCentered,
    zoomIn: () => zoomCentered(scaleRef.current + ZOOM_CONFIG.BUTTON_STEP),
    zoomOut: () => zoomCentered(scaleRef.current - ZOOM_CONFIG.BUTTON_STEP),
    goHome,
  };
}
