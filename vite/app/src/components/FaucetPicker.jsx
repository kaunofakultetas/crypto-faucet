// -----------------------------------------------------------
//  [*] FaucetPicker — the navbar's what-am-I-getting dropdown
//
//  One compact dropdown for all five faucet types, because
//  they are not all keyed by the same thing:
//
//    UTXO  → a network  (Bitcoin Testnet4, …)
//    EVM   → a network  (Sepolia, Arbitrum Sepolia, …)
//    ERC-20→ a TOKEN    (Chainlink, …) — the token lives on
//                        many chains, so the chain is chosen
//                        on the page, not here
//    SVM   → a network  (Solana Devnet, …)
//    MOVE  → a network  (Sui Testnet, …)
//
//  The component knows nothing about that distinction: it
//  takes a ready list of { key, primary, secondary, icon }
//  items from the navbar and navigates to
//  /faucet/<type>/<key>. The pick is remembered per type as
//  lastPick:<type>; favourites are stored as <type>:<key>,
//  since catalog keys are only unique within a family. Each
//  row's identity mark is an AssetIcon
//  (components/AssetIcon.jsx) — the backend icon when one
//  exists, a coloured hash-dot otherwise.
//
//  Split into (root component last):
//
//    useSelectedKey — the picked key straight from the URL
//    useLocalStorage — JSON state persisted per key
//    ItemRow        — one selectable menu row
//    FaucetPicker   — button + menu (default export)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Box, Button, Divider, IconButton, InputAdornment, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import SearchIcon from '@mui/icons-material/Search';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import AssetIcon from './AssetIcon';







// -----------------------------------------------------------
// useSelectedKey
// -----------------------------------------------------------
//
// The picked key straight from the URL
// (/faucet/<type>/<key>) — the route is the source of truth,
// so there is no selection state to keep in sync.
//
// Used by:
//   - FaucetPicker (below)
// -----------------------------------------------------------

function useSelectedKey(faucetType) {
  const location = useLocation();
  const match = location.pathname.match(new RegExp(`^/faucet/${faucetType}/([^/]+)`));
  return match?.[1] ?? null;
}







// -----------------------------------------------------------
// useLocalStorage
// -----------------------------------------------------------
//
//   const [value, setValue] = useLocalStorage(key, initial)
//
// useState that survives reloads: JSON under the given
// localStorage key, read once on mount, written on every
// change. Storage failures (private mode, quota) degrade to
// plain state.
//
// Used by:
//   - FaucetPicker (below) — the favourites list
// -----------------------------------------------------------

function useLocalStorage(key, initialValue) {

  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      // corrupt JSON or blocked storage — start fresh
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode or quota — degrade to plain state */
    }
  }, [key, value]);

  return [value, setValue];
}







// -----------------------------------------------------------
// ItemRow
// -----------------------------------------------------------
//
// One row of the menu: the asset's mark, the item's name, its
// secondary line (chain id, or how many chains a token lives
// on) and the favourite star — stopPropagation on the star,
// so pinning doesn't also select.
//
// Used by:
//   - FaucetPicker (below)
// -----------------------------------------------------------

function ItemRow({ item, isFavorite, isSelected, onToggleFavorite, onSelect }) {
  return (
    <MenuItem selected={isSelected} onClick={() => onSelect(item)} sx={{ gap: 1.5, py: 1 }}>
      <AssetIcon assetKey={item.key} icon={item.icon} size={24} />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }} noWrap>
          {item.primary}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }} noWrap>
          {item.secondary}
        </Typography>
      </Box>

      <Tooltip title={isFavorite ? 'Pašalinti iš mėgstamų' : 'Pridėti į mėgstamus'}>
        <IconButton
          size="small"
          aria-pressed={isFavorite}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(item.key);
          }}
          sx={{ color: isFavorite ? 'warning.main' : 'text.secondary' }}
        >
          {isFavorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </MenuItem>
  );
}







// -----------------------------------------------------------
// FaucetPicker (default export)
// -----------------------------------------------------------
//
//   <FaucetPicker items={…} loading faucetType label />
//
// The trigger button plus its anchored menu. `label` is what
// the button says when nothing is picked yet ("Pasirinkti
// tinklą" / "Pasirinkti žetoną"). The filter matches both
// lines of a row, and favourites float to the top under their
// own divider.
//
// Used by:
//   - Navbar.jsx — next to the faucet-type switch
// -----------------------------------------------------------

export default function FaucetPicker({ items = [], loading = false, faucetType, label }) {

  const navigate = useNavigate();
  const selectedKey = useSelectedKey(faucetType);

  const [anchorEl, setAnchorEl] = useState(null);
  const [filter, setFilter] = useState('');
  const [favorites, setFavorites] = useLocalStorage('favFaucetPicks', []);

  const open = Boolean(anchorEl);
  const selected = items.find((i) => i.key === selectedKey) || null;

  const needle = filter.trim().toLowerCase();
  const matching = needle
    ? items.filter((i) => `${i.primary} ${i.secondary} ${i.key}`.toLowerCase().includes(needle))
    : items;

  // Favourites are namespaced by type — 'knf' the UTXO
  // network and a 'knf' EVM chain must not star each other
  const favKey = (key) => `${faucetType}:${key}`;
  const favoriteItems = matching.filter((i) => favorites.includes(favKey(i.key)));
  const otherItems = matching.filter((i) => !favorites.includes(favKey(i.key)));


  const closeMenu = () => {
    setAnchorEl(null);
    setFilter('');
  };


  const toggleFavorite = (key) => {
    setFavorites((prev) => {
      const set = new Set(prev);
      if (set.has(favKey(key))) set.delete(favKey(key));
      else set.add(favKey(key));
      return Array.from(set);
    });
  };


  // Selecting remembers the pick per faucet type (for the "/"
  // redirect and the navbar's quick-open button), then
  // navigates
  const handleSelect = (item) => {
    if (item?.key) {
      try { localStorage.setItem(`lastPick:${faucetType}`, item.key); } catch { /* blocked storage — the pick just won't be remembered */ }
      navigate(`/faucet/${faucetType}/${item.key}`);
    }
    closeMenu();
  };


  return (
    <>
      {/* The trigger — current pick's dot + name */}
      <Button
        id="faucet-picker-button"
        variant="outlined"
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : undefined}
        aria-controls={open ? 'faucet-picker-menu' : undefined}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        endIcon={<ArrowDropDownIcon />}
        sx={{
          color: 'white',
          borderColor: 'white',
          borderWidth: 1,
          p: 0.9,
          '&:hover': { borderColor: 'white', backgroundColor: '#78003F' },
          textTransform: 'none',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* selectedKey keeps the dot's colour stable while
              the catalog is still loading — the URL already
              knows the key */}
          <AssetIcon assetKey={selected?.key ?? selectedKey} icon={selected?.icon} size={20} />
          <span>{selected?.primary || selectedKey || label}</span>
        </Box>
      </Button>

      <Menu
        id="faucet-picker-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={closeMenu}
        autoFocus={false}
        MenuListProps={{ 'aria-labelledby': 'faucet-picker-button' }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 320, maxHeight: 420, mt: 0.5 } } }}
      >
        {/* Filter — printable keystrokes must not reach the
            menu's own type-ahead, or the field loses focus on
            every letter; named keys (Escape, the arrows, Tab)
            must reach it, or the menu can't be closed or
            walked from the keyboard */}
        <Box sx={{ px: 1.5, pt: 0.5, pb: 1 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="Filtruoti…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {loading && (
          <MenuItem disabled>Kraunama…</MenuItem>
        )}

        {!loading && matching.length === 0 && (
          <MenuItem disabled>Nieko nerasta</MenuItem>
        )}

        {favoriteItems.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            isFavorite
            isSelected={item.key === selectedKey}
            onToggleFavorite={toggleFavorite}
            onSelect={handleSelect}
          />
        ))}

        {favoriteItems.length > 0 && otherItems.length > 0 && <Divider />}

        {otherItems.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            isFavorite={false}
            isSelected={item.key === selectedKey}
            onToggleFavorite={toggleFavorite}
            onSelect={handleSelect}
          />
        ))}
      </Menu>
    </>
  );
}
