// -----------------------------------------------------------
//  [*] Navbar — the burgundy top bar
//
//  Shown on every page: the VU KnF logo linking to "/", the
//  faucet controls (on faucet pages a segmented faucet-type
//  switch plus the network dropdown, elsewhere a quick
//  "Atidaryti Faucet'ą" button), the Vaizdo Įrašai link and
//  the "Kiti Įrankiai" dropdown with the teaching tools.
//
//  What the dropdown lists depends on the type, because the
//  faucets are keyed differently: EVM, UTXO and SVM by
//  NETWORK, ERC-20 by TOKEN (one token lives on many chains —
//  picking the chain happens on the page). FAUCET_TYPES holds
//  that difference; everything else treats all four alike.
//
//  All catalogs load once on mount. A family whose catalog
//  answers EMPTY is hidden everywhere — no switch segment, no
//  jumps into it: deleting (or emptying) a family's map in
//  _CONFIG/coins.py is how the operator disables a whole coin
//  type. Faucet jumps land on whatever the student picked
//  last for that type (lastPick:<type> in localStorage), then
//  the backend default, then the catalog's first entry.
//
//  Split into (root component last):
//
//    WHITE_OUTLINED_SX  — shared white outline button look
//    FAUCET_TYPES       — the four types: endpoint, how to
//                         turn its payload into picker items,
//                         labels (exported)
//    useFaucetCatalogs  — every type's items + default pick
//                         (exported)
//    faucetTargetFor    — where a jump into one type lands
//                         (exported)
//    FaucetTypeSwitch   — segmented switch, live types only
//    ToolsMenu          — "Kiti Įrankiai" dropdown
//    Navbar             — navigation logic + layout
//                         (default export)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useQueries } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Box, Button, Menu, MenuItem, ToggleButton, ToggleButtonGroup } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CurrencyBitcoinIcon from '@mui/icons-material/CurrencyBitcoin';

import FaucetPicker from './FaucetPicker';


// The white outline every navbar button shares
const WHITE_OUTLINED_SX = {
  color: 'white',
  borderColor: 'white',
  '&:hover': { borderColor: 'white', backgroundColor: '#78003F' },
};







// -----------------------------------------------------------
// FAUCET_TYPES
// -----------------------------------------------------------
//
// The four faucet types, in navbar order. Per entry:
//
//   key       — route prefix, /faucet/<key>/<pick>
//   label     — segmented switch caption
//   pickLabel — dropdown placeholder ("networks" vs "tokens")
//   api       — the catalog endpoint
//   queryKey  — the TanStack Query cache key; shared with the
//               pages that fetch the same endpoint, so the
//               catalog and the page cost ONE request
//   itemsOf   — turns that payload into picker items
//               ({ key, primary, secondary }), which is where
//               the network-keyed types and ERC-20 part
//   defaultOf — the backend's suggested pick
//
// A type with no entries in its catalog is a DISABLED family
// — the switch, the jumps and App.jsx's "/" redirect all skip
// it. There is no hardcoded fallback pick on purpose: every
// target must exist in the catalog or the jump doesn't happen.
//
// Used by:
//   - useFaucetCatalogs / FaucetTypeSwitch / Navbar (below)
//   - App.jsx — DynamicDefaultRedirect walks this table
// -----------------------------------------------------------

export const FAUCET_TYPES = [
  {
    key: 'utxo',
    label: 'UTXO',
    pickLabel: 'Pasirinkti tinklą',
    api: '/api/utxo/networks',
    queryKey: ['utxo-networks'],
    defaultOf: (data) => data.default_network ?? null,
    itemsOf: (data) => Object.entries(data.networks ?? {})
      .sort(([, a], [, b]) => (a.id ?? 0) - (b.id ?? 0))
      .map(([key, network]) => ({
        key,
        primary: network.full_name || key,
        secondary: `Tinklas: ${network.chain ?? 'testnet'}`,
        icon: network.icon ?? null,
      })),
  },
  {
    key: 'evm',
    label: 'EVM',
    pickLabel: 'Pasirinkti tinklą',
    api: '/api/evm/networks',
    queryKey: ['evm-networks'],
    defaultOf: (data) => data.default_network ?? null,
    itemsOf: (data) => Object.entries(data.networks ?? {})
      .sort(([, a], [, b]) => (a.id ?? 0) - (b.id ?? 0))
      .map(([key, network]) => ({
        key,
        primary: network.full_name || key,
        secondary: `Chain ID: ${network.chain_id}`,
        icon: network.icon ?? null,
      })),
  },
  {
    key: 'svm',
    label: 'SVM',
    pickLabel: 'Pasirinkti tinklą',
    api: '/api/svm/networks',
    queryKey: ['svm-networks'],
    defaultOf: (data) => data.default_network ?? null,
    itemsOf: (data) => Object.entries(data.networks ?? {})
      .sort(([, a], [, b]) => (a.id ?? 0) - (b.id ?? 0))
      .map(([key, network]) => ({
        key,
        primary: network.full_name || key,
        secondary: `${network.chunk_size} ${network.symbol} · ${network.cluster}`,
        icon: network.icon ?? null,
      })),
  },
  {
    key: 'erc20',
    label: 'ERC-20',
    pickLabel: 'Pasirinkti žetoną',
    api: '/api/erc20/tokens',
    queryKey: ['erc20-tokens'],
    defaultOf: (data) => data.default_token ?? null,
    itemsOf: (data) => Object.entries(data.tokens ?? {})
      .map(([key, token]) => ({
        key,
        primary: `${token.name} (${token.symbol})`,
        secondary: `${token.chunk_size} ${token.symbol} · ${token.networks.length} tinkl.`,
        icon: token.icon ?? null,
      })),
  },
];







// -----------------------------------------------------------
// useFaucetCatalogs
// -----------------------------------------------------------
//
//   const catalogs = useFaucetCatalogs()
//   catalogs.evm / .erc20 / .utxo
//     → { items, defaultKey, loading }
//
// All four catalogs as TanStack queries, driven by the
// FAUCET_TYPES table — each entry's own itemsOf turns its
// payload into ready picker items. The cache keys are shared
// with the pages, so a catalog the page already fetched is
// free. A catalog that fails to load just ends up empty —
// indistinguishable from a family the operator disabled, and
// treated the same way: hidden.
//
// Every successful payload is ALSO persisted to localStorage
// (catalog:<type>) and used as initialData on the next
// mount: the in-memory query cache dies with the page, so
// without this every refresh re-decided the navbar from four
// in-flight requests — tabs and names flickered while the
// answers landed. With it, a refresh renders the last known
// navbar instantly; the queries still refetch immediately
// (initialDataUpdatedAt 0), so a config change reconciles on
// its first fetch and is stable from then on.
//
// Used by:
//   - Navbar (below)
//   - App.jsx — DynamicDefaultRedirect, the "/" route
// -----------------------------------------------------------

// The persisted last-known payload of one catalog, or
// undefined (never null — initialData treats null as data)
const readCatalogCache = (typeKey) => {
  try {
    return JSON.parse(localStorage.getItem(`catalog:${typeKey}`)) ?? undefined;
  } catch (_) {
    return undefined;
  }
};

export function useFaucetCatalogs() {

  const results = useQueries({
    queries: FAUCET_TYPES.map((type) => ({
      queryKey: type.queryKey,
      queryFn: async () => {
        const { data } = await axios.get(type.api);
        try { localStorage.setItem(`catalog:${type.key}`, JSON.stringify(data)); } catch (_) {}
        return data;
      },
      staleTime: 5 * 60 * 1000,
      initialData: () => readCatalogCache(type.key),
      initialDataUpdatedAt: 0,
    })),
  });

  return Object.fromEntries(FAUCET_TYPES.map((type, i) => [type.key, {
    items: results[i].data ? type.itemsOf(results[i].data) : [],
    defaultKey: results[i].data ? type.defaultOf(results[i].data) : null,
    loading: results[i].isPending,
  }]));
}




// -----------------------------------------------------------
// faucetTargetFor
// -----------------------------------------------------------
//
//   faucetTargetFor(catalogs.evm, 'evm')  →  'sepolia' | null
//
// Where a jump into one faucet type lands: the student's last
// pick for that type (lastPick:<type> in localStorage), the
// backend default, or the catalog's first entry — whichever
// is the FIRST that actually exists in the catalog, so a
// network removed from the config can never be navigated to
// from a stale pick. null while the catalog is empty (still
// loading, or the family is disabled) — jumps are skipped
// instead of landing on a dead page.
//
// Used by:
//   - Navbar (below) — the switch and the quick-open button
//   - App.jsx — DynamicDefaultRedirect, the "/" route
// -----------------------------------------------------------

export function faucetTargetFor(catalog, typeKey) {
  const { items, defaultKey } = catalog;
  if (items.length === 0) return null;

  let saved = null;
  try {
    saved = localStorage.getItem(`lastPick:${typeKey}`);
  } catch (_) {}

  const exists = (key) => items.some((item) => item.key === key);
  if (saved && exists(saved)) return saved;
  if (defaultKey && exists(defaultKey)) return defaultKey;
  return items[0].key;
}







// -----------------------------------------------------------
// FaucetTypeSwitch
// -----------------------------------------------------------
//
// The segmented faucet-type switch. Only the LIVE types
// arrive in `types` — a family the operator disabled is not
// rendered at all. Exclusive selection, and a click on the
// already-active segment is ignored (MUI hands over null) so
// the page never navigates to nothing.
//
// Used by:
//   - Navbar (below)
// -----------------------------------------------------------

function FaucetTypeSwitch({ types, faucetType, onChange }) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={faucetType}
      onChange={(_, next) => next && onChange(next)}
      sx={{
        '& .MuiToggleButton-root': {
          color: 'white',
          borderColor: 'white',
          textTransform: 'none',
          px: 1.5,
          '&:hover': { backgroundColor: '#8f0050' },
          '&.Mui-selected': {
            backgroundColor: 'white',
            color: '#78003F',
            fontWeight: 700,
            '&:hover': { backgroundColor: 'white' },
          },
        },
      }}
    >
      {types.map((type) => (
        <ToggleButton key={type.key} value={type.key}>
          {type.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}







// -----------------------------------------------------------
// ToolsMenu
// -----------------------------------------------------------
//
// The "Kiti Įrankiai" dropdown: the teaching tools that don't
// warrant their own top-level button. Owns its anchor state.
//
// Used by:
//   - Navbar (below)
// -----------------------------------------------------------

function ToolsMenu() {

  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Button
        id="tools-button"
        aria-controls={open ? 'tools-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        variant="outlined"
        endIcon={<ArrowDropDownIcon />}
        sx={WHITE_OUTLINED_SX}
      >
        Kiti Įrankiai
      </Button>

      <Menu
        id="tools-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{ 'aria-labelledby': 'tools-button' }}
        sx={{
          '& .MuiPaper-root': {
            backgroundColor: '#78003F',
            color: 'white',
            border: '1px solid white',
          },
        }}
      >
        <MenuItem to="/dapps-server" component={Link} onClick={handleClose}>
          DAPPS Serveris
        </MenuItem>
        <MenuItem to="/sha256" component={Link} onClick={handleClose}>
          Blockchain Simuliatorius
        </MenuItem>
      </Menu>
    </>
  );
}







// -----------------------------------------------------------
// Navbar (default export)
// -----------------------------------------------------------
//
// Holds the faucet type (synced from the URL, so a direct
// /faucet/erc20/... link flips the switch) and the faucet
// navigation. Only the types whose catalogs have entries are
// rendered — a family the operator disabled (empty map in
// _CONFIG/coins.py) has no segment and no jumps, and if it
// was the selected type, the selection hops to the first live
// family. Jump targets come from faucetTargetFor, so they
// always exist in the catalog.
//
// Used by:
//   - App.jsx — the page shell
// -----------------------------------------------------------

export default function Navbar() {

  const location = useLocation();
  const navigate = useNavigate();

  const catalogs = useFaucetCatalogs();

  // 'evm' | 'erc20' | 'utxo' | 'svm' — follows the faucet
  // URL, and survives leaving the faucet pages
  const [faucetType, setFaucetType] = useState('evm');

  // A type stays visible while its catalog loads (so the
  // switch doesn't rebuild on every cold load) and disappears
  // once the backend confirms there is nothing in it
  const enabledTypes = FAUCET_TYPES.filter(
    (type) => catalogs[type.key].loading || catalogs[type.key].items.length > 0,
  );

  const active = catalogs[faucetType];
  const activeType = FAUCET_TYPES.find((t) => t.key === faucetType);
  const isOnFaucet = /^\/faucet\/(evm|erc20|utxo|svm)(\/|$)/.test(location.pathname);


  // A direct link to another faucet type flips the switch
  // without anyone touching it
  useEffect(() => {
    const m = location.pathname.match(/^\/faucet\/(evm|erc20|utxo|svm)\//);
    if (m?.[1]) setFaucetType(m[1]);
  }, [location.pathname]);


  // A disabled family must not stay selected: once its
  // catalog is confirmed empty, hop to the first family that
  // has something — the switch highlight and the quick-open
  // button never point at a hidden type
  useEffect(() => {
    if (active.loading || active.items.length > 0) return;
    const firstLive = FAUCET_TYPES.find((t) => catalogs[t.key].items.length > 0);
    if (firstLive) setFaucetType(firstLive.key);
  }, [active.loading, active.items.length, catalogs]);

  const goToFaucet = (typeKey) => {
    const target = faucetTargetFor(catalogs[typeKey], typeKey);
    if (target) navigate(`/faucet/${typeKey}/${target}`);
  };

  const handleTypeChange = (next) => {
    setFaucetType(next);
    if (isOnFaucet) goToFaucet(next);
  };


  return (
    <div className="bg-[var(--color-primary)] py-2 px-5 text-white font-bold">
      <div className="flex flex-wrap items-center gap-5">

        {/* Logo links back to "/" */}
        <Link to="/">
          <img src="/img/logo_knf.png" alt="VU Kauno fakultetas" className="h-[60px]" />
        </Link>

        {/* Faucet controls: type + network on faucet pages, a
            quick-open button everywhere else */}
        <div className="ml-4">
          {isOnFaucet ? (
            enabledTypes.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <FaucetTypeSwitch types={enabledTypes} faucetType={faucetType} onChange={handleTypeChange} />

                <FaucetPicker
                  items={active.items}
                  loading={active.loading}
                  faucetType={faucetType}
                  label={activeType.pickLabel}
                />
              </Box>
            )
          ) : (
            <Button
              onClick={() => goToFaucet(faucetType)}
              variant="outlined"
              startIcon={<CurrencyBitcoinIcon />}
              disabled={!faucetTargetFor(active, faucetType)}
              sx={{ ...WHITE_OUTLINED_SX, textTransform: 'none' }}
            >
              Atidaryti Faucet&apos;ą
            </Button>
          )}
        </div>

        {/* Spacer pushes the right-side buttons to the edge */}
        <div className="ml-auto" />

        <Button component={Link} to="/videos" variant="outlined" sx={WHITE_OUTLINED_SX}>
          Vaizdo Įrašai
        </Button>

        <ToolsMenu />

      </div>
    </div>
  );
}
