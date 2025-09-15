import React from 'react';
import { Box, Typography, Paper, Button, TextField, FormControl, InputLabel, Select, MenuItem, IconButton, Divider, Alert, Switch, FormControlLabel } from '@mui/material';
import { MdAdd, MdRemove, MdSend, MdWifi, MdWifiOff, MdClose } from "react-icons/md";

const ControlPanel = ({ 
  isPanelOpen, setIsPanelOpen, isConnectedToPublic, onConnectionToggle, rawTransaction, setRawTransaction, onSendRawTransaction,
  transactions, onAddTransaction, onRemoveTransaction, newTxid, setNewTxid, selectedColor, setSelectedColor,
  networkStatus, PANEL_WIDTH, TRANSACTION_COLORS 
}) => {
  
  // Control panel functions - now use props handlers
  const handleSendRawTransaction = () => {
    if (rawTransaction.trim() && onSendRawTransaction) {
      onSendRawTransaction();
    }
  };

  const handleAddTransaction = () => {
    if (newTxid.trim() && onAddTransaction) {
      onAddTransaction();
    }
  };

  const handleRemoveTransaction = (txidToRemove) => {
    if (onRemoveTransaction) {
      onRemoveTransaction(txidToRemove);
    }
  };

  const handleConnectionToggle = (event) => {
    if (onConnectionToggle) {
      onConnectionToggle(event.target.checked);
    }
  };

  return (
    <Paper 
      elevation={3}
      sx={{ 
        position: 'fixed', 
        top: 0, 
        right: isPanelOpen ? 0 : '-100%', 
        width: PANEL_WIDTH, 
        height: '100vh',
        p: 2, 
        zIndex: 1000,
        overflow: 'auto',
        transition: 'right 0.3s ease-in-out',
        backgroundColor: 'white',
        '& @keyframes pulse': {
          '0%': {
            opacity: 1,
            transform: 'scale(1)',
          },
          '50%': {
            opacity: 0.7,
            transform: 'scale(1.2)',
          },
          '100%': {
            opacity: 1,
            transform: 'scale(1)',
          },
        }
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          Valdymo Skydas
        </Typography>
        <IconButton 
          onClick={() => setIsPanelOpen(false)}
          size="small"
          sx={{ color: 'text.secondary' }}
        >
          <MdClose />
        </IconButton>
      </Box>
      
      {/* Connection Status */}
      <Box sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={isConnectedToPublic}
              onChange={handleConnectionToggle}
              color="primary"
            />
          }
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {isConnectedToPublic ? <MdWifi /> : <MdWifiOff />}
              {isConnectedToPublic ? 'Prisijungę prie viešo tinklo' : 'Atjungę nuo viešo tinklo'}
            </Box>
          }
        />
        <Alert 
          severity={isConnectedToPublic ? 'success' : 'warning'} 
          sx={{ mt: 1, fontSize: '0.8rem' }}
        >
          {isConnectedToPublic 
            ? 'Mazgas operuoja viešai' 
            : 'Mazgas operuoja privačiai'
          }
        </Alert>
        
        {/* Network Status Details */}
        {networkStatus && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
              Tinklų Būsena:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, fontSize: '0.75rem' }}>
              {networkStatus.connection && (
                <Typography variant="caption" color="text.secondary">
                  Peers: {networkStatus.connection.peers?.length || 0}
                </Typography>
              )}
              {networkStatus.publicTip && (
                <Typography variant="caption" color="text.secondary">
                  Viešo tinklo viršūnės aukštis: {networkStatus.publicTip.height} 
                  {networkStatus.publicTip.available ? ' ✅' : ' ❌'}
                </Typography>
              )}
              {networkStatus.privateTip && (
                <Typography variant="caption" color="text.secondary">
                  Privataus mazgo viršūnės aukštis: {networkStatus.privateTip.height}
                  {networkStatus.privateTip.available ? ' ✅' : ' ❌'}
                </Typography>
              )}
            </Box>
          </Box>
        )}
      </Box>

      <Divider sx={{ mb: 2 }} />

      {/* Send Raw Transaction */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
          Siųsti Transakciją į Privatų Mazgą
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder="Įveskite transakciją HEX formatu..."
          value={rawTransaction}
          onChange={(e) => setRawTransaction(e.target.value)}
          variant="outlined"
          size="small"
          sx={{ mb: 1 }}
        />
        <Button
          fullWidth
          variant="contained"
          onClick={handleSendRawTransaction}
          disabled={!rawTransaction.trim()}
          startIcon={<MdSend />}
          sx={{ backgroundColor: '#1976d2' }}
        >
          Siųsti Transakciją
        </Button>
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* Transaction Tracking */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 'bold' }}>
          Transakcijų Sekimas
        </Typography>
        
        {/* Add New Transaction */}
        <Box sx={{ mb: 2 }}>
          <TextField
            fullWidth
            placeholder="Įveskite transakcijos ID..."
            value={newTxid}
            onChange={(e) => setNewTxid(e.target.value)}
            variant="outlined"
            size="small"
            sx={{ mb: 1 }}
          />
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel>Spalva</InputLabel>
              <Select
                value={selectedColor}
                onChange={(e) => setSelectedColor(e.target.value)}
                label="Color"
              >
                {TRANSACTION_COLORS.map(color => (
                  <MenuItem key={color} value={color}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box 
                        sx={{ 
                          width: 16, 
                          height: 16, 
                          borderRadius: '50%', 
                          backgroundColor: color,
                          border: '1px solid rgba(0,0,0,0.2)'
                        }} 
                      />
                      {color.charAt(0).toUpperCase() + color.slice(1)}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              onClick={handleAddTransaction}
              disabled={!newTxid.trim()}
              startIcon={<MdAdd />}
              size="small"
            >
              Add
            </Button>
          </Box>
        </Box>

        {/* Tracked Transactions List */}
        <Box>
          <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
            Sekamos Transakcijos ({transactions.length})
          </Typography>
          {transactions.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              Nesekama nei viena transakcija
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {transactions.map((tx, index) => (
                <Box key={tx.txid} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box 
                        sx={{ 
                          width: 12, 
                          height: 12, 
                          borderRadius: '50%', 
                          backgroundColor: tx.color,
                          border: '1px solid rgba(0,0,0,0.2)'
                        }} 
                      />
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                        {tx.txid.substring(0, 12)}...
                      </Typography>
                    </Box>
                    <IconButton 
                      size="small" 
                      onClick={() => handleRemoveTransaction(tx.txid)}
                      sx={{ p: 0.5 }}
                    >
                      <MdRemove size={14} />
                    </IconButton>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                    {tx.blocks && tx.blocks.length > 0 
                      ? `Found in ${tx.blocks.length} block(s)`
                      : 'Nerasta nei viename bloke'
                    }
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Paper>
  );
};

export default ControlPanel;
