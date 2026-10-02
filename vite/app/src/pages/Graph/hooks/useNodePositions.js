// -----------------------------------------------------------
//  [*] Graph — useNodePositions
//
//  Persistence for dragged nodes: an address → X map, saved
//  under graphNodePositions:<network>:<day> in localStorage
//  and reloaded whenever the scope changes — every viewed day
//  is a different graph, so every (network, day) pair keeps
//  its own arrangement. Only X survives — Y always comes from
//  the node's level row. setLevelNextX deals X slots left to
//  right per level so new nodes never stack; noteX tells the
//  dealer where a restored or dragged node already sits, so a
//  newcomer after a reload lands to the RIGHT of everything
//  on its level instead of on top of it.
//
//  Old scopes are pruned on save, so a browser profile never
//  fills its quota with days nobody will open again: never
//  more than KEEP_SCOPES arrangements stay, the one being
//  saved always among them.
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
// Makes room for the arrangement about to be saved under
// `keepKey`: of the OTHER saved arrangements only the newest
// KEEP_SCOPES − 1 stay, so together with the one being saved
// there are never more than KEEP_SCOPES. Counting the saved
// one before it had its key used to leave one too many. The
// scope being saved is never the one dropped — a student
// arranging an old day keeps that arrangement, and the
// oldest of the others goes instead. Every key ends in its
// day's date, so the last ten characters order the scopes by
// day across networks.
//
// Used by:
//   - useNodePositions (below) — before every save
// -----------------------------------------------------------

const pruneOldScopes = (keepKey) => {
  const prefix = STORAGE_KEYS.NODE_POSITIONS_PREFIX;
  const others = Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix) && key !== keepKey)
    .sort((a, b) => a.slice(-10).localeCompare(b.slice(-10)));
  others.slice(0, Math.max(0, others.length - (KEEP_SCOPES - 1))).forEach((key) => localStorage.removeItem(key));
};







// -----------------------------------------------------------
// useNodePositions (default export)
// -----------------------------------------------------------
//
// One (network, day) scope's arrangement: the address → x Map
// itself (a ref, reloaded in place when the scope changes),
// its save, the slot dealer setLevelNextX and noteX, which
// tells the dealer where a node already sits. The save
// answers whether the write landed — a full quota is the one
// failure worth knowing about.
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
      pruneOldScopes(storageKey);
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


  // Where a node already sits — restored from storage or
  // dropped by a drag — so the dealer never hands that slot
  // out again
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
