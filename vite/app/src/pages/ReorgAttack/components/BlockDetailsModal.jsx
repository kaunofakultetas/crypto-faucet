import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, IconButton, Box, Typography, Chip, Divider, Tooltip } from '@mui/material';
import { Close as CloseIcon, ContentCopy as ContentCopyIcon } from '@mui/icons-material';
import { SiHackaday } from "react-icons/si";
import { BiWorld } from "react-icons/bi";

const BlockDetailsModal = ({ 
  open, 
  onClose, 
  blockData, 
  transactions = [],
  isPublicTip,
  isPrivateTip,
  isAttacker 
}) => {
  const [copyHints, setCopyHints] = React.useState({});

  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyHints(prev => ({ ...prev, [field]: true }));
      setTimeout(() => {
        setCopyHints(prev => ({ ...prev, [field]: false }));
      }, 1000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (!blockData) return null;

  const { block } = blockData;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      BackdropProps={{
        sx: {
          backgroundColor: 'transparent',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        },
      }}
    >
      <DialogTitle sx={{ pr: 6, bgcolor: isAttacker ? 'rgba(244, 67, 54, 0.1)' : 'rgba(33, 150, 243, 0.1)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            Bloko Informacija
          </Typography>
          
          {isAttacker ? (
            <Chip 
              label="Attacker Block"
              color="error"
              size="small"
            />
          ) : (
            <Chip 
              label="Honest Block"
              size="small"
              sx={{
                backgroundColor: 'lightblue',
              }}
            />
          )}
        </Box>
        
        <IconButton 
          aria-label="close" 
          onClick={onClose} 
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'grid', gap: 1 }}>

            {/* Height */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Bloko Aukštis
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {block.height}
              </Typography>
            </Box>

            {/* ChainWork (Log2) */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Grandinės Sukauptinis Visas Darbas (Log2)
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {Number(block.chainWork)}
              </Typography>
            </Box>

            {/* SHA256 Hash */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Bloko SHA256 Hash (Šio)
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {block.hash}
                </Typography>
              </Box>
            </Box>

            {/* Previous SHA256 Hash */}
            {block.prevHash && block.prevHash !== 'genesis' && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Bloko SHA256 Hash (Ankstesnio)
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {block.prevHash}
                  </Typography>
                </Box>
              </Box>
            )}

            {/* SCRYPT Hash */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Bloko SCRYPT Hash (Šio)
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {block.scryptHash}
              </Typography>
            </Box>

            {/* Coinbase Message */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Coinbase Žinutė
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {block.coinbase}
              </Typography>
            </Box>

            {/* Timestamp */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Laikas
              </Typography>
              <Typography variant="body2">
                {block.date} {block.time}
              </Typography>
            </Box>


          </Box>
        </Box>

        {/* Transactions */}
        {transactions && transactions.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box>
              <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                Sekamos Transakcijos ({transactions.length})
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {transactions.map((tx, idx) => (
                  <Tooltip key={idx} title={`Transakcija ${idx + 1}`}>
                    <Chip
                      label={`TX ${idx + 1}`}
                      size="small"
                      sx={{
                        bgcolor: tx.color,
                        color: 'white',
                        '&:hover': {
                          opacity: 0.8
                        }
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Box>
          </>
        )}


        {/* Transakcijos */}
        <Divider sx={{ my: 2 }} />
        <Box>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Sekamos Transakcijos
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {transactions.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                Šiame bloke sekamų transakcijų nėra
              </Typography>
            ) : (
              transactions.map((tx, idx) => (
                <Chip
                  key={idx}
                  label={`TX ${idx + 1}`}
                  size="small"
                />
              ))
            )}
            
          </Box>
        </Box>


      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Uždaryti
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BlockDetailsModal;