// -----------------------------------------------------------
//  [*] Graph — ZoomControls
//
//  Floating panel in the graph's top-right corner: a vertical
//  slider between round plus/minus buttons. Purely controlled
//  — the scale value and every handler come from the parent.
// -----------------------------------------------------------

import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import IconButton from '@mui/material/IconButton';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

import { DIMENSIONS } from '../constants';


// Shared look of the round plus/minus zoom buttons
const ZOOM_BUTTON_SX = {
  bgcolor: 'primary.main',
  color: 'common.white',
  '&:hover': { bgcolor: 'primary.dark' },
  width: 24,
  height: 24,
  borderRadius: '50%',
};







// -----------------------------------------------------------
// ZoomControls (default export)
// -----------------------------------------------------------
//
// Used by:
//   - CryptoFlowGraph.jsx — floating over the graph canvas
// -----------------------------------------------------------

export default function ZoomControls({ scale, min, max, step, onScaleChange, onZoomIn, onZoomOut }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        right: 12,
        top: 12,
        backgroundColor: 'rgba(255,255,255,0.9)',
        border: '1px solid #ddd',
        borderRadius: 2,
        p: 0.5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
      }}
    >
      <IconButton size="small" onClick={onZoomIn} aria-label="Priartinti" sx={ZOOM_BUTTON_SX}>
        <AddIcon fontSize="small" />
      </IconButton>

      <Slider
        orientation="vertical"
        value={scale}
        min={min}
        max={max}
        step={step}
        onChange={(_, value) => onScaleChange(Array.isArray(value) ? value[0] : value)}
        sx={{ height: DIMENSIONS.ZOOM_SLIDER_HEIGHT, mx: 0.5 }}
      />

      <IconButton size="small" onClick={onZoomOut} aria-label="Nutolinti" sx={ZOOM_BUTTON_SX}>
        <RemoveIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
