// -----------------------------------------------------------
//  [*] Graph — useNodePositions
//
//  Persistence for dragged nodes: an address → X map, saved
//  under graphNodePositions:<network>:<day> in localStorage
//  and reloaded whenever the scope changes — every viewed day
//  is a different graph, so every (network, day) pair keeps
//  its own arrangement. Only X survives — Y always comes from
//  the hierarchical layout. setLevelNextX deals X slots left
//  to right per hierarchy level so new nodes never stack.
// -----------------------------------------------------------

import { useEffect, useRef } from 'react';

import { LAYOUT_CONFIG, STORAGE_KEYS } from './constants';







// -----------------------------------------------------------
// useNodePositions (default export)
// -----------------------------------------------------------
//
//   const { positionsRef, save, setLevelNextX } =
//     useNodePositions(`${network}:${day}`)
//
// Used by:
//   - useTransactionGraph.js — one instance per graph
// -----------------------------------------------------------

export default function useNodePositions(scopeKey) {

  // address → x for placed nodes; level → last dealt x for
  // spacing the next newcomer at that level
  const positionsRef = useRef(new Map());
  const levelsRef = useRef(new Map());

  const storageKey = `${STORAGE_KEYS.NODE_POSITIONS_PREFIX}${scopeKey}`;


  const save = () => {
    try {
      const obj = {};
      positionsRef.current.forEach((x, key) => {
        if (typeof key === 'string' && typeof x === 'number') {
          obj[key] = x;
        }
      });
      localStorage.setItem(storageKey, JSON.stringify(obj));
    } catch (error) {
      console.warn('Failed to save node positions to localStorage:', error);
    }
  };


  // Load per storage key — a network switch first drops the
  // previous network's entries; bad JSON just means starting
  // with a clean slate
  useEffect(() => {
    positionsRef.current.clear();
    levelsRef.current.clear();
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const obj = JSON.parse(raw);
      Object.entries(obj).forEach(([address, xPosition]) => {
        const x = Number(xPosition);
        if (!Number.isNaN(x)) positionsRef.current.set(address, x);
      });
    } catch (error) {
      console.warn('Failed to load node positions from localStorage:', error);
    }
  }, [storageKey]);


  const setLevelNextX = (level) => {
    const lastX = levelsRef.current.get(level) || 0;
    const nextX = lastX + LAYOUT_CONFIG.NODE_HORIZONTAL_INCREMENT;
    levelsRef.current.set(level, nextX);
    return nextX;
  };


  return { positionsRef, save, setLevelNextX };
}
