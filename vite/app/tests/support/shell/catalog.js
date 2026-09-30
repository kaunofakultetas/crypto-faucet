// -----------------------------------------------------------
//  [*] Test support — catalog variations for the shell tests
//
//  The navbar and App.jsx's "/" redirect decide everything
//  from GET /api/faucet/catalog. These build the variations
//  the shell tests need from the canonical fixture, never
//  touching it:
//
//    - a family DISABLED the way the backend disables one —
//      its slice empty: { default_network: null, networks: {} }
//      ({ default_token: null, tokens: {} } for ERC-20), the
//      shape the backend's tests/test_disabled_families.py
//      pins
//    - a slice replaced (a default pointing at a network the
//      map no longer has, a reordered map …)
//    - the navbar's persisted copy of the last payload
//      (localStorage 'catalog:v2', read as initialData on the
//      next load) and the student's last picks
//      (lastPick:<type>)
//
//  Split into:
//
//    CATALOG_CACHE_KEY — the navbar's localStorage key
//    EMPTY_SLICES      — every family, disabled
//    catalogWithout    — the fixture with families disabled
//    catalogWith       — the fixture with slices replaced
//    rememberCatalog   — seed the persisted copy
//    rememberPick      — seed lastPick:<type>
//
//  Used by:
//    - core/app.test.jsx, core/error-boundary.test.jsx
//    - components/navbar.test.jsx
// -----------------------------------------------------------

import * as f from '../backend/fixtures';


// The key Navbar.jsx persists the catalog under — versioned,
// so a payload of an older shape is never replayed
export const CATALOG_CACHE_KEY = 'catalog:v2';

// A disabled family's slice, per family
export const EMPTY_SLICES = {
  utxo: { default_network: null, networks: {} },
  evm: { default_network: null, networks: {} },
  erc20: { default_token: null, tokens: {} },
  svm: { default_network: null, networks: {} },
  move: { default_network: null, networks: {} },
};







// -----------------------------------------------------------
// catalogWithout / catalogWith
// -----------------------------------------------------------
//
//   catalogWithout('evm', 'utxo')   — those families disabled
//   catalogWith({ evm: { … } })     — those slices replaced
//
// Both return a fresh deep copy.
//
// Used by:
//   - core/app.test.jsx, components/navbar.test.jsx
// -----------------------------------------------------------

export const catalogWith = (slices) => structuredClone({ ...f.catalog, ...slices });

export const catalogWithout = (...families) => catalogWith(
  Object.fromEntries(families.map((family) => [family, EMPTY_SLICES[family]])),
);







// -----------------------------------------------------------
// rememberCatalog / rememberPick
// -----------------------------------------------------------
//
//   rememberCatalog(payload)        — as if a previous visit
//                                     had fetched it (a string
//                                     is stored as it is)
//   rememberPick('evm', 'hoodi')    — as if the student had
//                                     picked it in the dropdown
//
// setup.js clears localStorage after every test.
//
// Used by:
//   - core/app.test.jsx, core/error-boundary.test.jsx
//   - components/navbar.test.jsx
// -----------------------------------------------------------

export const rememberCatalog = (payload) => {
  localStorage.setItem(CATALOG_CACHE_KEY, typeof payload === 'string' ? payload : JSON.stringify(payload));
};

export const rememberPick = (type, key) => {
  localStorage.setItem(`lastPick:${type}`, key);
};
