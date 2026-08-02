// -----------------------------------------------------------
//  [*] ReorgAttack — ToggleButton
//
//  The floating gear button in the bottom-right corner that
//  opens and closes the control panel. Sits above the panel's
//  own z-index, so it stays reachable while the panel is out.
// -----------------------------------------------------------

import { IconButton } from '@mui/material';
import { MdSettings } from 'react-icons/md';







// -----------------------------------------------------------
// ToggleButton (default export)
// -----------------------------------------------------------
//
// Used by:
//   - Page.jsx — opens/closes ControlPanel
// -----------------------------------------------------------

export default function ToggleButton({ onToggle }) {
  return (
    <IconButton
      onClick={onToggle}
      aria-label="Valdymo skydas"
      sx={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        backgroundColor: 'primary.main',
        color: 'white',
        zIndex: 1001,
        width: 56,
        height: 56,
        '&:hover': {
          backgroundColor: 'primary.dark',
        },
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      <MdSettings size={28} />
    </IconButton>
  );
}
