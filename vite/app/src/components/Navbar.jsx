// components/Navbar.jsx
import React from 'react';
import axios from 'axios';
import { Link, useLocation, useNavigate } from 'react-router-dom';

/* MUI components */
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { Box, FormControl, InputLabel, Select } from '@mui/material';

/* MUI icons */
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CurrencyBitcoinIcon from '@mui/icons-material/CurrencyBitcoin';


import NetworkPicker from './NetworkPicker';

/* ------------------------------------------------------------------
 * Main navigation bar
 * ------------------------------------------------------------------*/
const Navbar = () => {
  /* ----------------------------------------------------------------
   * MUI dropdown state handlers
   * -------------------------------------------------------------- */
  const [anchorEl, setAnchorEl] = React.useState(null);
  const open = Boolean(anchorEl);
  const [platform, setPlatform] = React.useState('evm'); // 'evm' | 'utxo'
  const [evmNetworks, setEvmNetworks] = React.useState({});
  const [evmDefault, setEvmDefault] = React.useState(null);
  const [evmLoading, setEvmLoading] = React.useState(true);
  const [utxoNetworks, setUtxoNetworks] = React.useState({});
  const [utxoDefault, setUtxoDefault] = React.useState(null);
  const [utxoLoading, setUtxoLoading] = React.useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  const handleMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  // Determine platform from URL
  React.useEffect(() => {
    const m = location.pathname.match(/^\/faucet\/(evm|utxo)\//);
    if (m?.[1]) setPlatform(m[1]);
  }, [location.pathname]);

  // Load EVM networks
  React.useEffect(() => {
    let ignore = false;
    const loadEvm = async () => {
      try {
        setEvmLoading(true);
        const { data } = await axios.get('/api/evm/networks');
        if (!ignore) {
          setEvmNetworks(data.networks ?? {});
          setEvmDefault(data.default_network ?? null);
        }
      } catch (e) {
        console.error('Unable to load EVM networks', e);
      } finally {
        if (!ignore) setEvmLoading(false);
      }
    };
    loadEvm();
    return () => { ignore = true; };
  }, []);

  // Load UTXO networks (best-effort)
  React.useEffect(() => {
    let ignore = false;
    const loadUtxo = async () => {
      try {
        setUtxoLoading(true);
        const { data } = await axios.get('/api/utxo/networks');
        if (!ignore) {
          setUtxoNetworks(data.networks ?? {});
          setUtxoDefault(data.default_network ?? null);
        }
      } catch (e) {
        // ok if not configured yet
        console.warn('UTXO networks not available', e);
      } finally {
        if (!ignore) setUtxoLoading(false);
      }
    };
    loadUtxo();
    return () => { ignore = true; };
  }, []);

  const isOnFaucet = /^\/faucet\/(evm|utxo)(\/|$)/.test(location.pathname);

  const handleOpenFaucet = () => {
    const prefix = platform || 'evm';
    let fallback = prefix === 'evm' ? 'sepolia' : 'btc';
    try {
      const saved = localStorage.getItem(`lastNetwork:${prefix}`);
      if (saved) fallback = saved;
    } catch (_) {}
    if (prefix === 'evm') fallback = fallback || evmDefault || 'sepolia';
    else fallback = fallback || utxoDefault || 'btc';
    navigate(`/faucet/${prefix}/${fallback}`);
  };

  const handlePlatformChange = (event) => {
    const next = event.target.value;
    setPlatform(next);
    if (isOnFaucet) {
      let target = next === 'evm' ? (evmDefault || 'sepolia') : (utxoDefault || 'btc');
      try {
        const saved = localStorage.getItem(`lastNetwork:${next}`);
        if (saved) target = saved;
      } catch (_) {}
      navigate(`/faucet/${next}/${target}`);
    }
  };

  return (
    <div className="bg-[var(--color-primary)] py-2 px-5 text-white font-bold">
      <div className="flex flex-wrap items-center gap-5">
        {/* Logo links back to root */}
        <Link to="/">
          <img
            src="/img/logo_knf.png"
            alt="VU Kauno fakultetas"
            className="h-[60px]"
          />
        </Link>

        {/* Platform dropdown + Network picker on faucet pages; otherwise quick open button */}
        <div className="ml-4">
          {isOnFaucet ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <FormControl size="small" variant="outlined" sx={{ minWidth: 160 }}>
                <InputLabel
                  id="platform-label"
                  sx={{ color: 'white', '&.Mui-focused': { color: 'white' } }}
                >
                  {/* Tipas */}
                </InputLabel>
                <Select
                  labelId="platform-label"
                  value={platform}
                  // label="Tipas"
                  onChange={handlePlatformChange}
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

              <NetworkPicker
                networksMap={platform === 'evm' ? evmNetworks : utxoNetworks}
                loading={platform === 'evm' ? evmLoading : utxoLoading}
                routePrefix={platform}
              />
            </Box>
          ) : (
            <Button
              onClick={handleOpenFaucet}
              variant="outlined"
              startIcon={<CurrencyBitcoinIcon />}
              disabled={(platform === 'evm' ? evmLoading : utxoLoading) && !(platform === 'evm' ? evmDefault : utxoDefault)}
              sx={{
                color: 'white',
                borderColor: 'white',
                '&:hover': { borderColor: 'white', backgroundColor: '#78003F' },
                textTransform: 'none',
              }}
            >
              Atidaryti Faucet'ą
            </Button>
          )}
        </div>

        {/* Spacer pushes dropdown to the right edge */}
        <div className="ml-auto" />

        {/* --- MUI Dropdown “Kiti Įrankiai” --- */}
        <Button
          id="tools-button"
          aria-controls={open ? 'tools-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          onClick={handleMenuOpen}
          variant="outlined"
          endIcon={<ArrowDropDownIcon />}
          sx={{
            color: 'white',
            borderColor: 'white',
            '&:hover': { borderColor: 'white', backgroundColor: '#78003F' },
          }}
        >
          Kiti Įrankiai
        </Button>

        <Menu
          id="tools-menu"
          anchorEl={anchorEl}
          open={open}
          onClose={handleMenuClose}
          MenuListProps={{ 'aria-labelledby': 'tools-button' }}
          sx={{
            '& .MuiPaper-root': {
              backgroundColor: '#78003F',
              color: 'white',
              border: '1px solid white',
            },
          }}
        >
          <MenuItem
            component={Link}
            to="/dapps-server"
            onClick={handleMenuClose}
          >
            DAPPS Serveris
          </MenuItem>
          <MenuItem
            component={Link}
            to="/sha256"
            onClick={handleMenuClose}
          >
            Blockchain Simuliatorius
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
};

export default Navbar;