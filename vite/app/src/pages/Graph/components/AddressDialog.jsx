import React from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CloseIcon from '@mui/icons-material/Close'
import Box from '@mui/material/Box'
import { copyToClipboard } from '../utils'

/**
 * AddressDialog - Modal dialog for managing address names and copying
 * 
 * Provides a user-friendly interface for:
 * - Setting/editing custom names for addresses
 * - Copying addresses to clipboard with visual feedback
 * - Blur backdrop effect when open
 * 
 * @param {boolean} open - Whether the dialog is visible
 * @param {Function} onClose - Handler for closing the dialog
 * @param {string} name - Current name value in the input field
 * @param {Function} setName - Handler for updating the name value
 * @param {string} address - The address being managed
 * @param {Function} onSave - Handler for saving the name
 * @returns {React.Component} The address management dialog
 */
const AddressDialog = ({
  open,
  onClose,
  name,
  setName,
  address,
  onSave,
}) => {
  const [copyHintOpen, setCopyHintOpen] = React.useState(false)

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
          <TextField fullWidth label="Adreso pavadinimas" value={name} onChange={(e) => setName(e.target.value)} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField fullWidth label="Adresas" value={address || ''} InputProps={{ readOnly: true }} />
          <Tooltip open={copyHintOpen} title="Nukopijuota" disableHoverListener>
            <IconButton
              aria-label="copy"
              onClick={async () => {
                const success = await copyToClipboard(address)
                if (success) {
                  setCopyHintOpen(true)
                  setTimeout(() => setCopyHintOpen(false), 1000)
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
  )
}

export default AddressDialog


