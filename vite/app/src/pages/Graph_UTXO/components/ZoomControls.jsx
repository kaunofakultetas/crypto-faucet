// -----------------------------------------------------------
//  [*] Graph_UTXO — ZoomControls
//
//  Floating panel at the graph's right edge: a vertical slider
//  between round plus / minus buttons. Purely controlled — the
//  scale value and every handler come from the parent. It sits
//  clear of the canvas' vertical scrollbar, which the EVM
//  graph (a scrollbar-less canvas) does not have to mind.
//
//  The same control as the EVM graph's
//  (pages/Graph/components/ZoomControls.jsx), props included —
//  keep the two in step until they share one file.
// -----------------------------------------------------------

import { Box, IconButton, Slider } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

import { LAYOUT_CONFIG, ZOOM_CONFIG } from '../constants';


// Shared look of the round plus / minus zoom buttons
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
// The panel, placed absolutely at the canvas container's top
// right, just under the pinned block-height row so it never
// covers a block's label: + zooms in one step, the slider
// sets the zoom directly (min..max in steps of `step`), −
// zooms out one step. It only reports — onScaleChange /
// onZoomIn / onZoomOut change the zoom in the parent.
//
// Used by:
//   - UtxoFlowGraph.jsx — floating over the canvas
// -----------------------------------------------------------

export default function ZoomControls({ scale, min, max, step, onScaleChange, onZoomIn, onZoomOut }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        right: 20,
        top: LAYOUT_CONFIG.HEADER_HEIGHT + 12,
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
        aria-label="Mastelis"
        sx={{ height: ZOOM_CONFIG.SLIDER_HEIGHT, mx: 0.5 }}
      />

      <IconButton size="small" onClick={onZoomOut} aria-label="Nutolinti" sx={ZOOM_BUTTON_SX}>
        <RemoveIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
