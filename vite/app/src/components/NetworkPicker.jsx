import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/* MUI */
import {
  Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, Tooltip, Typography,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import CloseIcon from '@mui/icons-material/Close';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';


function colorFromString(input) {
  if (!input) return 'grey.500';
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  const hue = Math.abs(hash) % 360;
  const saturation = 65;
  const lightness = 55;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}


function useSelectedNetworkKey(prefix = 'evm') {
  const location = useLocation();
  const rx = new RegExp(`^/faucet/${prefix}/([^/]+)`);
  const match = location.pathname.match(rx);
  return match?.[1] ?? null;
}


function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch (_) {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* ignore */
    }
  }, [key, value]);

  return [value, setValue];
}


const NetworkTile = ({ option, isFavorite, onToggleFavorite, onSelect, routePrefix }) => {
  return (
    <Box
      onClick={() => onSelect(option)}
      className="group cursor-pointer"
      sx={{
        border: '1px solid rgba(255,255,255,0.35)',
        borderRadius: 2,
        p: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        '&:hover': { backgroundColor: 'rgba(255,255,255,0.08)' },
      }}
    >
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: colorFromString(option.key),
          flex: '0 0 auto',
        }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 600, lineHeight: 1.2, color: 'white' }} noWrap>
          {option.full_name || option.key}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }} noWrap>
          {(option.short_name ?? '').toString()}
          {option.short_name ? ' • ' : ''}
          {routePrefix === 'evm' ? `Chain ID: ${option.chain_id}` : `Tinklas: ${option.chain ?? 'testnet'}`}
        </Typography>
      </Box>
      <Tooltip title={isFavorite ? 'Pašalinti iš mėgstamų' : 'Pridėti į mėgstamus'}>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(option.key);
          }}
          sx={{ color: isFavorite ? 'warning.main' : 'rgba(255,255,255,0.7)' }}
        >
          {isFavorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Box>
  );
};


const NetworkPicker = ({ networksMap = {}, loading = false, routePrefix = 'evm' }) => {
  const navigate = useNavigate();
  const selectedKey = useSelectedNetworkKey(routePrefix);

  const [open, setOpen] = useState(false);
  const [networks, setNetworks] = useState({});
  const [favorites, setFavorites] = useLocalStorage('favNetworks', []);

  useEffect(() => {
    setNetworks(networksMap || {});
  }, [networksMap]);

  const options = useMemo(() => {
    const arr = Object.entries(networks).map(([key, conf]) => ({ key, ...conf }));
    arr.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return arr;
  }, [networks]);

  const selected = useMemo(
    () => options.find((o) => o.key === selectedKey) || null,
    [options, selectedKey],
  );

  const toggleFavorite = useCallback(
    (key) => {
      setFavorites((prev) => {
        const set = new Set(prev);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        return Array.from(set);
      });
    },
    [setFavorites],
  );

  const handleSelect = useCallback(
    (opt) => {
      if (opt?.key) {
        try { localStorage.setItem(`lastNetwork:${routePrefix}`, opt.key); } catch (_) { }
        navigate(`/faucet/${routePrefix}/${opt.key}`);
      }
      setOpen(false);
    },
    [navigate, routePrefix],
  );

  const favoriteOptions = useMemo(
    () => options.filter((o) => favorites.includes(o.key)),
    [options, favorites],
  );
  const otherOptions = useMemo(
    () => options.filter((o) => !favorites.includes(o.key)),
    [options, favorites],
  );

  return (
    <>
      <Button
        variant="outlined"
        onClick={() => setOpen(true)}
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
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: colorFromString(selected?.key),
              flex: '0 0 auto',
            }}
          />
          <span>{selected?.full_name || selected?.key || 'Pasirinkti tinklą'}</span>
        </Box>
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        BackdropProps={{
          sx: {
            backgroundColor: 'transparent',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
          Pasirinkti tinklą
          {selected ? (
            <Chip
              size="small"
              sx={{ ml: 1 }}
              label={selected.full_name || selected.key}
            />
          ) : null}
          <IconButton
            aria-label="close"
            onClick={() => setOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ background: 'linear-gradient(180deg,#78003F 0%, #52002C 100%)' }}>
          {loading ? (
            <Typography color="white">Kraunama…</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {favoriteOptions.length > 0 && (
                <Box>
                  <Typography sx={{ color: 'white', mb: 1, fontWeight: 600 }}>
                    Mėgstami
                  </Typography>
                  <Box className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {favoriteOptions.map((opt) => (
                      <NetworkTile
                        key={opt.key}
                        option={opt}
                        isFavorite={favorites.includes(opt.key)}
                        onToggleFavorite={toggleFavorite}
                        onSelect={handleSelect}
                        routePrefix={routePrefix}
                      />
                    ))}
                  </Box>
                </Box>
              )}

              <Box>
                <Typography sx={{ color: 'white', mb: 1, fontWeight: 600 }}>
                  Visi tinklai
                </Typography>
                <Box className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {otherOptions.map((opt) => (
                      <NetworkTile
                      key={opt.key}
                      option={opt}
                      isFavorite={favorites.includes(opt.key)}
                      onToggleFavorite={toggleFavorite}
                        onSelect={handleSelect}
                        routePrefix={routePrefix}
                    />
                  ))}
                </Box>
              </Box>

              {!favoriteOptions.length && !otherOptions.length && (
                <Typography color="white">Nieko nerasta</Typography>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default NetworkPicker;


