// -----------------------------------------------------------
//  [*] Graph_UTXO — useBackgroundPan
//
//  Drag the canvas background to scroll it, the way the EVM
//  graph pans: a mouse press on empty space grabs the canvas,
//  and moving the mouse scrolls it both ways, 1:1 with the
//  pointer (the pointer is captured, so leaving the canvas
//  mid-drag keeps panning). A press on a transaction box is
//  left alone — the box drags itself — and so is a press on
//  the scroller element itself, which can only be its
//  scrollbars. Touch needs none of this: a finger already
//  scrolls the canvas natively (the boxes opt out of that with
//  touch-action).
// -----------------------------------------------------------

import { useRef, useState } from 'react';







// -----------------------------------------------------------
// useBackgroundPan (default export)
// -----------------------------------------------------------
//
// Panning by dragging the empty canvas. The caller spreads
// panHandlers — the pointer handlers — on the scroller it
// passed in, and shows the grabbing cursor while `panning`
// holds: a mouse press on empty canvas starts the pan, a
// move scrolls, and the release — or a cancelled pointer —
// ends it.
//
// Used by:
//   - UtxoFlowGraph.jsx — on the canvas' scrolling element
// -----------------------------------------------------------

export default function useBackgroundPan(scrollerRef) {

  const panRef = useRef(null);
  const [panning, setPanning] = useState(false);


  const onPointerDown = (event) => {
    // The mouse's primary button, on the canvas itself — not a
    // box (role="button"), not the scroller's own scrollbars
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if (event.target === event.currentTarget || event.target.closest('[role="button"]')) return;

    // No text selection or focus shuffle while grabbing
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: scrollerRef.current.scrollLeft,
      top: scrollerRef.current.scrollTop,
    };
    setPanning(true);
  };


  // The content follows the pointer: moving right reveals what
  // lies to the left
  const onPointerMove = (event) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    scrollerRef.current.scrollLeft = pan.left - (event.clientX - pan.startX);
    scrollerRef.current.scrollTop = pan.top - (event.clientY - pan.startY);
  };


  const endPan = (event) => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
  };


  return {
    panning,
    panHandlers: { onPointerDown, onPointerMove, onPointerUp: endPan, onPointerCancel: endPan },
  };
}
