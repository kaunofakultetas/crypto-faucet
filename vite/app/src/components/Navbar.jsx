// -----------------------------------------------------------
//  [*] Navbar — the burgundy top bar
//
//  Shown on every page: the VU KnF logo linking to "/", the
//  faucet controls (on faucet pages a segmented EVM / ERC-20 /
//  UTXO switch plus the network dropdown, elsewhere a quick
//  "Atidaryti Faucet'ą" button), the Vaizdo Įrašai link and
//  the "Kiti Įrankiai" dropdown with the teaching tools.
//
//  What the dropdown lists depends on the type, because the
//  faucets are keyed differently: EVM and UTXO by NETWORK,
//  ERC-20 by TOKEN (one token lives on many chains — picking
//  the chain happens on the page). FAUCET_TYPES holds that
//  difference; everything else treats all three alike.
//
//  All three catalogs load once on mount. Faucet jumps land
//  on whatever the student picked last for that type
//  (lastPick:<type> in localStorage), then the backend
//  default, then a hardcoded fallback.
//
//  Split into (root component last):
//
//    WHITE_OUTLINED_SX  — shared white outline button look
//    FAUCET_TYPES       — the three types: endpoint, how to
//                         turn its payload into picker items,
//                         labels, fallback
//    useFaucetCatalogs  — every type's items + default pick
//    FaucetTypeSwitch   — segmented EVM / ERC-20 / UTXO
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
// The three faucet types, in navbar order. Per entry:
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
//               EVM/UTXO (networks) and ERC-20 (tokens) part
//   defaultOf — the backend's suggested pick
//   fallback  — last resort when nothing else answers
//
// Used by:
//   - useFaucetCatalogs / FaucetTypeSwitch / Navbar (below)
// -----------------------------------------------------------

const FAUCET_TYPES = [
  {
    key: 'evm',
    label: 'EVM',
    pickLabel: 'Pasirinkti tinklą',
    api: '/api/evm/networks',
    queryKey: ['evm-networks'],
    fallback: 'sepolia',
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
    key: 'erc20',
    label: 'ERC-20',
    pickLabel: 'Pasirinkti žetoną',
    api: '/api/erc20/tokens',
    queryKey: ['erc20-tokens'],
    fallback: null,
    defaultOf: (data) => data.default_token ?? null,
    itemsOf: (data) => Object.entries(data.tokens ?? {})
      .map(([key, token]) => ({
        key,
        primary: `${token.name} (${token.symbol})`,
        secondary: `${token.chunk_size} ${token.symbol} · ${token.networks.length} tinkl.`,
        icon: token.icon ?? null,
      })),
  },
  {
    key: 'utxo',
    label: 'UTXO',
    pickLabel: 'Pasirinkti tinklą',
    api: '/api/utxo/networks',
    queryKey: ['utxo-networks'],
    fallback: 'btc4',
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
];







// -----------------------------------------------------------
// useFaucetCatalogs
// -----------------------------------------------------------
//
//   const catalogs = useFaucetCatalogs()
//   catalogs.evm / .erc20 / .utxo
//     → { items, defaultKey, loading }
//
// All three catalogs as TanStack queries, driven by the
// FAUCET_TYPES table — each entry's own itemsOf turns its
// payload into ready picker items. The cache keys are shared
// with the pages, so a catalog the page already fetched is
// free. A catalog that fails to load just ends up empty (the
// stack may run without UTXO or with no tokens configured) —
// the navbar still works.
//
// Used by:
//   - Navbar (below)
// -----------------------------------------------------------

function useFaucetCatalogs() {

  const results = useQueries({
    queries: FAUCET_TYPES.map((type) => ({
      queryKey: type.queryKey,
      queryFn: async () => (await axios.get(type.api)).data,
      staleTime: 5 * 60 * 1000,
    })),
  });

  return Object.fromEntries(FAUCET_TYPES.map((type, i) => [type.key, {
    items: results[i].data ? type.itemsOf(results[i].data) : [],
    defaultKey: results[i].data ? type.defaultOf(results[i].data) : null,
    loading: results[i].isPending,
  }]));
}







// -----------------------------------------------------------
// FaucetTypeSwitch
// -----------------------------------------------------------
//
// The segmented EVM / ERC-20 / UTXO switch. Exclusive
// selection, and a click on the already-active segment is
// ignored (MUI hands over null) so the page never navigates
// to nothing.
//
// Used by:
//   - Navbar (below)
// -----------------------------------------------------------

function FaucetTypeSwitch({ faucetType, onChange }) {
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
      {FAUCET_TYPES.map((type) => (
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
        <MenuItem to="/reorgattack" component={Link} onClick={handleClose}>
          51% Atakos Simuliacija
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
// navigation. faucetTarget resolves where a jump lands: the
// student's last pick for that type → backend default →
// hardcoded fallback. A type with nothing to offer (no tokens
// configured) resolves to null and its jumps are skipped
// rather than navigating to /faucet/erc20/null.
//
// Used by:
//   - App.jsx — the page shell
// -----------------------------------------------------------

export default function Navbar() {

  const location = useLocation();
  const navigate = useNavigate();

  const catalogs = useFaucetCatalogs();

  // 'evm' | 'erc20' | 'utxo' — follows the faucet URL, and
  // survives leaving the faucet pages
  const [faucetType, setFaucetType] = useState('evm');

  const active = catalogs[faucetType];
  const activeType = FAUCET_TYPES.find((t) => t.key === faucetType);
  const isOnFaucet = /^\/faucet\/(evm|erc20|utxo)(\/|$)/.test(location.pathname);


  // A direct link to another faucet type flips the switch
  // without anyone touching it
  useEffect(() => {
    const m = location.pathname.match(/^\/faucet\/(evm|erc20|utxo)\//);
    if (m?.[1]) setFaucetType(m[1]);
  }, [location.pathname]);


  // Where a faucet jump lands: last pick → backend default →
  // hardcoded fallback (null when the type has nothing yet)
  const faucetTarget = (typeKey) => {
    const type = FAUCET_TYPES.find((t) => t.key === typeKey);
    let saved = null;
    try {
      saved = localStorage.getItem(`lastPick:${typeKey}`);
    } catch (_) {}
    return saved || catalogs[typeKey].defaultKey || type.fallback;
  };

  const goToFaucet = (typeKey) => {
    const target = faucetTarget(typeKey);
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <FaucetTypeSwitch faucetType={faucetType} onChange={handleTypeChange} />

              <FaucetPicker
                items={active.items}
                loading={active.loading}
                faucetType={faucetType}
                label={activeType.pickLabel}
              />
            </Box>
          ) : (
            <Button
              onClick={() => goToFaucet(faucetType)}
              variant="outlined"
              startIcon={<CurrencyBitcoinIcon />}
              disabled={active.loading && !active.defaultKey}
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
