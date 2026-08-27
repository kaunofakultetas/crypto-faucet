// -----------------------------------------------------------
//  [*] Navbar — the burgundy top bar
//
//  Shown on every page: the VU KnF logo linking to "/", the
//  faucet controls (on faucet pages a segmented faucet-type
//  switch plus the network dropdown, elsewhere a quick
//  "Atidaryti faucet'ą" button), the Vaizdo įrašai link and
//  the "Kiti įrankiai" dropdown with the teaching tools.
//
//  What the dropdown lists depends on the type, because the
//  faucets are keyed differently: EVM, UTXO, SVM and MOVE by
//  NETWORK, ERC-20 by TOKEN (one token lives on many chains —
//  picking the chain happens on the page). FAUCET_TYPES holds
//  that difference; everything else treats all five alike.
//
//  The whole offering arrives in ONE request on mount
//  (/api/faucet/catalog — every family's catalog in a single
//  payload). A family whose slice is EMPTY is hidden
//  everywhere — no switch segment, no jumps into it: deleting
//  (or emptying) a family's map in _CONFIG/coins.py is how
//  the operator disables a whole coin type. Faucet jumps land
//  on whatever the student picked last for that type
//  (lastPick:<type> in localStorage), then the backend
//  default, then the catalog's first entry. A catalog that
//  could NOT be fetched (and nothing cached) is not "every
//  family disabled": the bar says so and offers a retry. A
//  URL into a family the operator disabled says that too,
//  instead of highlighting some other family above the page.
//
//  Split into (root component last):
//
//    WHITE_OUTLINED_SX  — shared white outline button look
//    networkCatalog     — the shared shape of network-keyed
//                         types
//    FAUCET_TYPES       — the five types as a table (exported)
//    useFaucetCatalogs  — the one-request catalog (exported)
//    faucetTargetFor    — where a jump into one type lands
//                         (exported)
//    FaucetTypeSwitch   — segmented switch, live types only
//    CatalogFailedNotice — the catalog could not be fetched
//    FamilyDisabledNotice — the URL's family is switched off
//    ToolsMenu          — "Kiti įrankiai" dropdown
//    Navbar             — navigation logic + layout
//                         (default export)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
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
// networkCatalog
// -----------------------------------------------------------
//
// The shared catalog shape of every network-keyed type: the
// slice's `networks` map as picker items in picker order,
// with the type's own `secondary` line — the ONLY thing that
// differs between UTXO, EVM, SVM and MOVE.
//
// Used by:
//   - FAUCET_TYPES (below) — every network-keyed entry
//     (utxo / evm / svm / move)
// -----------------------------------------------------------

const networkCatalog = (secondaryOf) => ({
  defaultOf: (data) => data.default_network ?? null,
  itemsOf: (data) => Object.entries(data.networks ?? {})
    .sort(([, a], [, b]) => (a.id ?? 0) - (b.id ?? 0))
    .map(([key, network]) => ({
      key,
      primary: network.full_name || key,
      secondary: secondaryOf(network),
      icon: network.icon ?? null,
    })),
});







// -----------------------------------------------------------
// FAUCET_TYPES
// -----------------------------------------------------------
//
// The five faucet types, in navbar order. Per entry:
//
//   key       — route prefix, /faucet/<key>/<pick>, and the
//               type's slice in the /api/faucet/catalog
//               payload
//   label     — segmented switch caption
//   pickLabel — dropdown placeholder ("networks" vs "tokens")
//   itemsOf   — turns the type's catalog slice into picker
//               items ({ key, primary, secondary }); the
//               network-keyed types share networkCatalog,
//               ERC-20 is keyed by TOKEN and has its own
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
    ...networkCatalog((network) => `Tinklas: ${network.chain ?? 'testnet'}`),
  },
  {
    key: 'evm',
    label: 'EVM',
    pickLabel: 'Pasirinkti tinklą',
    ...networkCatalog((network) => `Chain ID: ${network.chain_id}`),
  },
  {
    key: 'erc20',
    label: 'ERC-20',
    pickLabel: 'Pasirinkti žetoną',
    defaultOf: (data) => data.default_token ?? null,
    itemsOf: (data) => Object.entries(data.tokens ?? {})
      .map(([key, token]) => ({
        key,
        primary: `${token.name} (${token.symbol})`,
        secondary: `${token.chunk_size} ${token.symbol} · ${token.networks?.length ?? 0} tinkl.`,
        icon: token.icon ?? null,
      })),
  },
  {
    key: 'svm',
    label: 'SVM',
    pickLabel: 'Pasirinkti tinklą',
    ...networkCatalog((network) => `${network.chunk_size} ${network.symbol} · ${network.cluster}`),
  },
  {
    key: 'move',
    label: 'MoveVM',
    pickLabel: 'Pasirinkti tinklą',
    ...networkCatalog((network) => `${network.chunk_size} ${network.symbol} · ${network.network}`),
  },
];







// -----------------------------------------------------------
// useFaucetCatalogs
// -----------------------------------------------------------
//
//   const { loading, families } = useFaucetCatalogs()
//   families.evm / .erc20 / .utxo / .svm / .move
//     → { items, defaultKey }
//
// The whole faucet offering from ONE request —
// GET /api/faucet/catalog answers with every family's public
// catalog keyed by type, so there is a single loading flag
// and never a partial answer to reconcile. Each entry's own
// itemsOf turns its slice into ready picker items. A fetch
// that failed with NOTHING cached is reported as `failed`
// (with refetch to try again) — every family is empty then,
// but that is an outage, not five disabled families; a
// failed refresh of a payload already on screen keeps it.
//
// The last successful payload is ALSO persisted to
// localStorage (CATALOG_CACHE_KEY) and used as initialData
// on the next mount: the in-memory query cache dies with the
// page, so without this every refresh re-decided the navbar
// from an in-flight request — tabs and names flickered while
// the answer landed. With it, a refresh renders the last
// known navbar instantly; the query still refetches
// immediately (initialDataUpdatedAt 0), so a config change
// reconciles on its first fetch and is stable from then on.
// The key carries a version: bump it when the payload shape
// changes, so an old cache is ignored instead of replayed
// into itemsOf on every reload.
//
// Used by:
//   - Navbar (below)
//   - App.jsx — DynamicDefaultRedirect, the "/" route
// -----------------------------------------------------------

const CATALOG_CACHE_KEY = 'catalog:v2';

// The persisted last-known catalog payload, or undefined
// (never null — initialData treats null as data)
const readCatalogCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY)) ?? undefined;
  } catch {
    // corrupt JSON or blocked storage — same as no cache
    return undefined;
  }
};

export function useFaucetCatalogs() {

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['faucet-catalog'],
    queryFn: async () => {
      const { data: catalog } = await axios.get('/api/faucet/catalog');
      try { localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalog)); } catch { /* private mode — the next load just refetches */ }
      return catalog;
    },
    staleTime: 5 * 60 * 1000,
    initialData: readCatalogCache,
    initialDataUpdatedAt: 0,
  });

  return {
    loading: isPending,
    failed: isError && !data,
    refetch,
    families: Object.fromEntries(FAUCET_TYPES.map((type) => [type.key, {
      items: data?.[type.key] ? type.itemsOf(data[type.key]) : [],
      defaultKey: data?.[type.key] ? type.defaultOf(data[type.key]) : null,
    }])),
  };
}







// -----------------------------------------------------------
// faucetTargetFor
// -----------------------------------------------------------
//
//   faucetTargetFor(families.evm, 'evm')  →  'sepolia' | null
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
  } catch { /* blocked storage — fall through to the default pick */ }

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
// CatalogFailedNotice
// -----------------------------------------------------------
//
// The catalog request failed and nothing is cached: instead
// of silently hiding every family (the shape a disabled
// family has), say so and offer a retry.
//
// Used by:
//   - Navbar (below) — in place of the faucet controls
// -----------------------------------------------------------

function CatalogFailedNotice({ onRetry }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <span className="text-sm font-normal">Faucet&apos;ų sąrašas nepasiekiamas</span>
      <Button onClick={() => onRetry()} variant="outlined" size="small" sx={{ ...WHITE_OUTLINED_SX, textTransform: 'none' }}>
        Bandyti dar kartą
      </Button>
    </Box>
  );
}







// -----------------------------------------------------------
// FamilyDisabledNotice
// -----------------------------------------------------------
//
// The URL names a family the operator switched off (a stale
// bookmark): the page below still renders, but no switch
// segment can honestly be highlighted — say so and offer the
// way to a live faucet.
//
// Used by:
//   - Navbar (below) — in place of the faucet controls
// -----------------------------------------------------------

function FamilyDisabledNotice() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <span className="text-sm font-normal">Šis faucet&apos;as šiuo metu išjungtas</span>
      <Button component={Link} to="/" variant="outlined" size="small" sx={{ ...WHITE_OUTLINED_SX, textTransform: 'none' }}>
        Į kitą faucet&apos;ą
      </Button>
    </Box>
  );
}







// -----------------------------------------------------------
// ToolsMenu
// -----------------------------------------------------------
//
// The "Kiti įrankiai" dropdown: the teaching tools that don't
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
        Kiti įrankiai
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
          DAPPS serveris
        </MenuItem>
        <MenuItem to="/sha256" component={Link} onClick={handleClose}>
          Blokų grandinės simuliatorius
        </MenuItem>
      </Menu>
    </>
  );
}







// -----------------------------------------------------------
// Navbar (default export)
// -----------------------------------------------------------
//
// Pure derivation over the URL and the catalog: the type in
// /faucet/<type>/... drives the switch highlight (the switch
// only renders on faucet pages, where the URL always knows
// the type), a one-cell memory keeps the quick-open button
// pointing where the student last was, and a selection whose
// family the operator disabled falls back to the first live
// one at render time. Clicking a segment just navigates —
// the highlight follows the URL.
//
// Used by:
//   - App.jsx — the page shell
// -----------------------------------------------------------

export default function Navbar() {

  const location = useLocation();
  const navigate = useNavigate();

  const { loading, failed, refetch, families } = useFaucetCatalogs();

  const urlType = location.pathname.match(/^\/faucet\/(evm|erc20|utxo|svm|move)(\/|$)/)?.[1] ?? null;

  // The URL's family is confirmed empty — the operator turned
  // it off; the notice replaces a switch that would otherwise
  // highlight a family the page is not on
  const urlTypeDisabled = Boolean(urlType) && !loading && !failed && families[urlType].items.length === 0;

  // Where the quick-open button leads after the student
  // leaves the faucet pages: the type they were on last
  const [rememberedType, setRememberedType] = useState('evm');
  useEffect(() => {
    if (urlType) setRememberedType(urlType);
  }, [urlType]);

  // Every type stays visible while the one catalog request is
  // in flight (so the switch doesn't rebuild on a cold load);
  // confirmed-empty families disappear
  const enabledTypes = FAUCET_TYPES.filter(
    (type) => loading || families[type.key].items.length > 0,
  );

  // The selection, corrected to the first live family when
  // the wanted one is disabled — render-time derivation, so
  // there is never a frame highlighting a hidden type
  const selected = urlType ?? rememberedType;
  const faucetType = enabledTypes.some((t) => t.key === selected)
    ? selected
    : (enabledTypes[0]?.key ?? selected);

  const active = families[faucetType];
  const activeType = FAUCET_TYPES.find((t) => t.key === faucetType);

  const goToFaucet = (typeKey) => {
    const target = faucetTargetFor(families[typeKey], typeKey);
    if (target) navigate(`/faucet/${typeKey}/${target}`);
  };


  return (
    <nav className="bg-[var(--color-primary)] py-2 px-5 text-white font-bold">
      <div className="flex flex-wrap items-center gap-5">

        {/* Logo links back to "/" */}
        <Link to="/">
          <img src="/img/logo_knf.png" alt="VU Kauno fakultetas" className="h-[60px]" />
        </Link>

        {/* Faucet controls: type + network on faucet pages, a
            quick-open button everywhere else */}
        <div className="ml-4">
          {failed ? (
            <CatalogFailedNotice onRetry={refetch} />
          ) : urlTypeDisabled ? (
            <FamilyDisabledNotice />
          ) : urlType ? (
            enabledTypes.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <FaucetTypeSwitch types={enabledTypes} faucetType={faucetType} onChange={goToFaucet} />

                <FaucetPicker
                  items={active.items}
                  loading={loading}
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
              Atidaryti faucet&apos;ą
            </Button>
          )}
        </div>

        {/* Spacer pushes the right-side buttons to the edge */}
        <div className="ml-auto" />

        <Button component={Link} to="/videos" variant="outlined" sx={WHITE_OUTLINED_SX}>
          Vaizdo įrašai
        </Button>

        <ToolsMenu />

      </div>
    </nav>
  );
}
