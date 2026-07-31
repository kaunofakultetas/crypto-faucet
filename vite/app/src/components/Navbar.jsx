// -----------------------------------------------------------
//  [*] Navbar — the burgundy top bar
//
//  Shown on every page: the VU KnF logo linking to "/", the
//  faucet controls (on faucet pages a chain-type switch + the
//  network picker, elsewhere a quick "Atidaryti Faucet'ą"
//  button), the Vaizdo Įrašai link and the "Kiti Įrankiai"
//  dropdown with the teaching tools.
//
//  Both network directories (EVM and UTXO) load once on
//  mount. Faucet jumps land on the network the student used
//  last (lastNetwork:<platform> in localStorage), then the
//  backend default, then a hardcoded fallback.
//
//  Split into (root component last):
//
//    WHITE_OUTLINED_SX    — shared white outline button look
//    useNetworksDirectory — EVM + UTXO lists and defaults
//    PlatformSelect       — the EVM/UTXO type switch
//    ToolsMenu            — "Kiti Įrankiai" dropdown
//    Navbar               — navigation logic + layout
//                           (default export)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Box, Button, FormControl, Menu, MenuItem, Select } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CurrencyBitcoinIcon from '@mui/icons-material/CurrencyBitcoin';

import NetworkPicker from './NetworkPicker';


// The white outline every navbar button shares
const WHITE_OUTLINED_SX = {
  color: 'white',
  borderColor: 'white',
  '&:hover': { borderColor: 'white', backgroundColor: '#78003F' },
};







// -----------------------------------------------------------
// useNetworksDirectory
// -----------------------------------------------------------
//
//   const { evm, utxo } = useNetworksDirectory()
//   // each: { networks, defaultKey, loading }
//
// Loads both platform directories once on mount. A missing
// UTXO config only warns — the stack may run EVM-only.
//
// Used by:
//   - Navbar (below)
// -----------------------------------------------------------

function useNetworksDirectory() {

  const [evm, setEvm] = useState({ networks: {}, defaultKey: null, loading: true });
  const [utxo, setUtxo] = useState({ networks: {}, defaultKey: null, loading: true });

  useEffect(() => {
    let ignore = false;

    axios.get('/api/evm/networks')
      .then(({ data }) => {
        if (!ignore) setEvm({ networks: data.networks ?? {}, defaultKey: data.default_network ?? null, loading: false });
      })
      .catch((e) => {
        console.error('Unable to load EVM networks', e);
        if (!ignore) setEvm((prev) => ({ ...prev, loading: false }));
      });

    axios.get('/api/utxo/networks')
      .then(({ data }) => {
        if (!ignore) setUtxo({ networks: data.networks ?? {}, defaultKey: data.default_network ?? null, loading: false });
      })
      .catch((e) => {
        console.warn('UTXO networks not available', e);
        if (!ignore) setUtxo((prev) => ({ ...prev, loading: false }));
      });

    return () => { ignore = true; };
  }, []);

  return { evm, utxo };
}







// -----------------------------------------------------------
// PlatformSelect
// -----------------------------------------------------------
//
// The white EVM/UTXO chain-type dropdown, shown only on
// faucet pages. Purely controlled by Navbar.
//
// Used by:
//   - Navbar (below)
// -----------------------------------------------------------

function PlatformSelect({ platform, onChange }) {
  return (
    <FormControl size="small" variant="outlined" sx={{ minWidth: 160 }}>
      <Select
        value={platform}
        onChange={onChange}
        sx={{
          color: 'white',
          '.MuiOutlinedInput-notchedOutline': { borderColor: 'white !important' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white !important' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'white !important' },
          '& .MuiSvgIcon-root': { color: 'white' },
        }}
      >
        <MenuItem value="evm">EVM Tipo Grandinės</MenuItem>
        <MenuItem value="utxo">UTXO Tipo Grandinės</MenuItem>
      </Select>
    </FormControl>
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
// Holds the platform choice (synced from the URL, so a direct
// /faucet/utxo/... link flips the switch) and the faucet
// navigation. faucetTarget resolves where a jump lands: last
// used network → backend default → hardcoded fallback.
//
// Used by:
//   - App.jsx — the page shell
// -----------------------------------------------------------

export default function Navbar() {

  const location = useLocation();
  const navigate = useNavigate();

  const { evm, utxo } = useNetworksDirectory();

  // 'evm' | 'utxo' — follows the faucet URL, survives leaving it
  const [platform, setPlatform] = useState('evm');

  const active = platform === 'evm' ? evm : utxo;
  const isOnFaucet = /^\/faucet\/(evm|utxo)(\/|$)/.test(location.pathname);


  // A direct link to the other platform's faucet flips the
  // switch without anyone touching it
  useEffect(() => {
    const m = location.pathname.match(/^\/faucet\/(evm|utxo)\//);
    if (m?.[1]) setPlatform(m[1]);
  }, [location.pathname]);


  // Where a faucet jump lands: last used → backend default →
  // hardcoded fallback
  const faucetTarget = (prefix) => {
    const dir = prefix === 'evm' ? evm : utxo;
    let saved = null;
    try {
      saved = localStorage.getItem(`lastNetwork:${prefix}`);
    } catch (_) {}
    return saved || dir.defaultKey || (prefix === 'evm' ? 'sepolia' : 'btc');
  };

  const handleOpenFaucet = () => {
    const prefix = platform || 'evm';
    navigate(`/faucet/${prefix}/${faucetTarget(prefix)}`);
  };

  const handlePlatformChange = (event) => {
    const next = event.target.value;
    setPlatform(next);
    if (isOnFaucet) {
      navigate(`/faucet/${next}/${faucetTarget(next)}`);
    }
  };


  return (
    <div className="bg-[var(--color-primary)] py-2 px-5 text-white font-bold">
      <div className="flex flex-wrap items-center gap-5">

        {/* Logo links back to "/" */}
        <Link to="/">
          <img src="/img/logo_knf.png" alt="VU Kauno fakultetas" className="h-[60px]" />
        </Link>

        {/* Faucet controls: platform + network picker on faucet
            pages, a quick-open button everywhere else */}
        <div className="ml-4">
          {isOnFaucet ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <PlatformSelect platform={platform} onChange={handlePlatformChange} />

              <NetworkPicker
                networksMap={active.networks}
                loading={active.loading}
                routePrefix={platform}
              />
            </Box>
          ) : (
            <Button
              onClick={handleOpenFaucet}
              variant="outlined"
              startIcon={<CurrencyBitcoinIcon />}
              disabled={active.loading && !active.defaultKey}
              sx={{ ...WHITE_OUTLINED_SX, textTransform: 'none' }}
            >
              Atidaryti Faucet'ą
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
