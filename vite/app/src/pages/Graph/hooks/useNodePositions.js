// -----------------------------------------------------------
//  [*] Graph — useNodePositions
//
//  Persistence for dragged nodes: an address → X map, saved
//  under graphNodePositions:<network>:<day> in localStorage
//  and reloaded whenever the scope changes — every viewed day
//  is a different graph, so every (network, day) pair keeps
//  its own arrangement. Only X survives — Y always comes from
//  the hierarchical layout. setLevelNextX deals X slots left
//  to right per hierarchy level so new nodes never stack;
//  noteX tells the dealer where a restored or dragged node
//  already sits, so a newcomer after a reload lands to the
//  RIGHT of everything on its level instead of on top of it.
//  Old scopes are pruned on save (the KEEP_SCOPES newest
//  days survive), so a browser profile never fills its quota
//  with days nobody will open again.
// -----------------------------------------------------------

import { useEffect, useRef } from 'react';

import { LAYOUT_CONFIG, STORAGE_KEYS } from '../constants';


// How many (network, day) arrangements survive — the newest
// days, whichever network they belong to
const KEEP_SCOPES = 30;







// -----------------------------------------------------------
// pruneOldScopes
// -----------------------------------------------------------
//
// Drops the oldest saved arrangements past KEEP_SCOPES. The
// key is '<prefix><network>:<YYYY-MM-DD>', so its last ten
// characters order the scopes by day across networks.
//
// Used by:
//   - useNodePositions (below) — before every save
// -----------------------------------------------------------

const pruneOldScopes = () => {
  const prefix = STORAGE_KEYS.NODE_POSITIONS_PREFIX;
  const keys = Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix))
    .sort((a, b) => a.slice(-10).localeCompare(b.slice(-10)));
  keys.slice(0, Math.max(0, keys.length - KEEP_SCOPES)).forEach((key) => localStorage.removeItem(key));
};







// -----------------------------------------------------------
// useNodePositions (default export)
// -----------------------------------------------------------
//
//   const { positionsRef, save, setLevelNextX, noteX } =
//     useNodePositions(`${network}:${day}`)
//
// save() answers whether the write landed — a full quota is
// the one failure worth knowing about.
//
// Used by:
//   - useTransactionGraph.js — one instance per graph
// -----------------------------------------------------------

export default function useNodePositions(scopeKey) {

  // address → x for placed nodes; level → the rightmost x
  // known at that level, so the next newcomer lands past it
  const positionsRef = useRef(new Map());
  const levelsRef = useRef(new Map());

  const storageKey = `${STORAGE_KEYS.NODE_POSITIONS_PREFIX}${scopeKey}`;


  const save = () => {
    const obj = {};
    positionsRef.current.forEach((x, key) => {
      if (typeof key === 'string' && typeof x === 'number') {
        obj[key] = x;
      }
    });

    try {
      pruneOldScopes();
      localStorage.setItem(storageKey, JSON.stringify(obj));
      return true;
    } catch (error) {
      console.warn('Failed to save node positions to localStorage:', error);
      return false;
    }
  };


  // Load per storage key — a network switch first drops the
  // previous network's entries; bad JSON just means starting
  // with a clean slate. The dealer's memory is rebuilt by the
  // store as nodes come in (noteX), since a bare x carries no
  // level.
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


  // Where a node already sits — restored from storage or just
  // merged — so the dealer never hands that slot out again
  const noteX = (level, x) => {
    const lastX = levelsRef.current.get(level) || 0;
    if (x > lastX) levelsRef.current.set(level, x);
  };

  const setLevelNextX = (level) => {
    const lastX = levelsRef.current.get(level) || 0;
    const nextX = lastX + LAYOUT_CONFIG.NODE_HORIZONTAL_INCREMENT;
    levelsRef.current.set(level, nextX);
    return nextX;
  };


  return { positionsRef, save, setLevelNextX, noteX };
}
