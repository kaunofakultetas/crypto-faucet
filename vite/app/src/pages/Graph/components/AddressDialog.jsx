// -----------------------------------------------------------
//  [*] Graph — AddressDialog
//
//  The right-click dialog of a node: rename the address (the
//  parent saves on Išsaugoti — an empty name clears the label,
//  the field is capped at NAME_MAX_LENGTH, and a failed save
//  shows under the field instead of closing the dialog) and
//  copy the raw address, with a 1 s "Nukopijuota" tooltip as
//  feedback. The backdrop blurs the graph instead of dimming
//  it.
// -----------------------------------------------------------

import { useState } from 'react';

import { NAME_MAX_LENGTH } from '../constants';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';







// -----------------------------------------------------------
// copyToClipboard
// -----------------------------------------------------------
//
// Clipboard write that reports success instead of throwing —
// the "Nukopijuota" hint shows only when it worked.
//
// Used by:
//   - AddressDialog (below) — the copy button
// -----------------------------------------------------------

const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text || '');
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
};







// -----------------------------------------------------------
// AddressDialog (default export)
// -----------------------------------------------------------
//
// Used by:
//   - CryptoFlowGraph.jsx — opened by the right-click handler
// -----------------------------------------------------------

export default function AddressDialog({ open, onClose, name, setName, address, error = null, onSave }) {

  const [copyHintOpen, setCopyHintOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
      <DialogTitle sx={{ pr: 6 }}>
        Adreso nustatymai
        <IconButton aria-label="uždaryti" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <TextField
            fullWidth
            label="Adreso pavadinimas"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, NAME_MAX_LENGTH))}
            inputProps={{ maxLength: NAME_MAX_LENGTH }}
            error={Boolean(error)}
            helperText={error ?? `${name.length}/${NAME_MAX_LENGTH}`}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField fullWidth label="Adresas" value={address || ''} InputProps={{ readOnly: true }} />
          <Tooltip open={copyHintOpen} title="Nukopijuota" disableHoverListener>
            <IconButton
              aria-label="copy"
              onClick={async () => {
                const success = await copyToClipboard(address);
                if (success) {
                  setCopyHintOpen(true);
                  setTimeout(() => setCopyHintOpen(false), 1000);
                }
              }}
            >
              <ContentCopyIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Atšaukti</Button>
        <Button variant="contained" onClick={onSave}>Išsaugoti</Button>
      </DialogActions>
    </Dialog>
  );
}
