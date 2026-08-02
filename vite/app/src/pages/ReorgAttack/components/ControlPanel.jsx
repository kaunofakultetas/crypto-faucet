// -----------------------------------------------------------
//  [*] ReorgAttack — ControlPanel
//
//  The sliding side panel that drives the attack: the switch
//  attaching or detaching the private node from the public
//  network, a raw HEX transaction sender, and the colour-coded
//  transaction tracker.
//
//  The panel OWNS its form state (the two text fields and
//  their colours) — the page only receives finished actions
//  (onSendRawTransaction({ raw, color })), so typing here
//  never re-renders the fork diagram.
//
//  Split into (root component last):
//
//    TRANSACTION_COLORS — the tracking palette
//    ColorSelect        — colour dropdown with colour dots
//    ConnectionSection  — the public-network switch + status
//    RawTransactionForm — the HEX sender
//    TrackedTransaction — one row of the tracked list
//    TrackingSection    — add form + tracked list
//    ControlPanel       — the panel shell (default export)
// -----------------------------------------------------------

import { useState } from 'react';

import {
  Box, Typography, Paper, Button, TextField, FormControl, InputLabel,
  Select, MenuItem, IconButton, Divider, Alert, Switch, FormControlLabel,
} from '@mui/material';

import { MdAdd, MdSend, MdWifi, MdWifiOff, MdClose } from 'react-icons/md';
import DeleteIcon from '@mui/icons-material/Delete';


// The palette a student picks from when colour-tracking a
// transaction across the two chains
const TRANSACTION_COLORS = ['red', 'green', 'blue', 'orange', 'purple', 'pink', 'cyan', 'yellow'];







// -----------------------------------------------------------
// ColorSelect
// -----------------------------------------------------------
//
// The tracking-colour dropdown: every option shows the colour
// as a dot next to its name.
//
// Used by:
//   - RawTransactionForm, TrackingSection (below)
// -----------------------------------------------------------

function ColorSelect({ value, onChange }) {
  return (
    <FormControl size="small" sx={{ flex: 1 }}>
      <InputLabel>Spalva</InputLabel>
      <Select value={value} label="Spalva" onChange={(event) => onChange(event.target.value)}>
        {TRANSACTION_COLORS.map((color) => (
          <MenuItem key={color} value={color}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  backgroundColor: color,
                  border: '1px solid rgba(0,0,0,0.2)',
                }}
              />
              {color.charAt(0).toUpperCase() + color.slice(1)}
            </Box>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}







// -----------------------------------------------------------
// ConnectionSection
// -----------------------------------------------------------
//
// The attack switch: detaching the private node lets it mine
// its own fork in secret. The switch reflects the BACKEND's
// reported state, so a failed toggle simply stays where it
// was — there is nothing to revert by hand.
//
// Used by:
//   - ControlPanel (below)
// -----------------------------------------------------------

function ConnectionSection({ isConnectedToPublic, onConnectionToggle, busy, networkStatus }) {
  return (
    <Box sx={{ mb: 3 }}>
      <FormControlLabel
        control={
          <Switch
            checked={isConnectedToPublic}
            onChange={(event) => onConnectionToggle(event.target.checked)}
            disabled={busy}
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

      <Alert severity={isConnectedToPublic ? 'success' : 'warning'} sx={{ mt: 1, fontSize: '0.8rem' }}>
        {isConnectedToPublic ? 'Mazgas operuoja viešai' : 'Mazgas operuoja privačiai'}
      </Alert>

      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
          Tinklų Būsena:
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
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
    </Box>
  );
}







// -----------------------------------------------------------
// RawTransactionForm
// -----------------------------------------------------------
//
// Broadcasts a raw HEX transaction straight into the private
// node — the field clears itself once the send is away.
//
// Used by:
//   - ControlPanel (below)
// -----------------------------------------------------------

function RawTransactionForm({ onSend, busy }) {

  const [raw, setRaw] = useState('');
  const [color, setColor] = useState('red');


  const send = () => {
    onSend({ raw: raw.trim(), color });
    setRaw('');
  };


  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
        Siųsti Transakciją į Privatų Mazgą
      </Typography>

      <TextField
        fullWidth
        multiline
        rows={3}
        placeholder="Įveskite transakciją HEX formatu..."
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        variant="outlined"
        size="small"
        sx={{ mb: 1 }}
      />

      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <ColorSelect value={color} onChange={setColor} />
      </Box>

      <Button
        fullWidth
        variant="contained"
        onClick={send}
        disabled={!raw.trim() || busy}
        startIcon={<MdSend />}
        sx={{ backgroundColor: '#1976d2' }}
      >
        Siųsti Transakciją
      </Button>
    </Box>
  );
}







// -----------------------------------------------------------
// TrackedTransaction
// -----------------------------------------------------------
//
// One tracked transaction: its colour dot, shortened txid and
// how many blocks it was found in — the number that exposes a
// double-spend when the chains disagree.
//
// Used by:
//   - TrackingSection (below)
// -----------------------------------------------------------

function TrackedTransaction({ transaction, onRemove, busy }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: transaction.color,
              border: '1px solid rgba(0,0,0,0.2)',
            }}
          />
          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
            {transaction.txid.substring(0, 12)}...
          </Typography>
        </Box>

        <IconButton size="small" onClick={() => onRemove(transaction.txid)} disabled={busy} sx={{ p: 0.5 }}>
          <DeleteIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
        {transaction.blocks?.length > 0
          ? `Rasta ${transaction.blocks.length} blokuose`
          : 'Nerasta nei viename bloke'}
      </Typography>
    </Box>
  );
}







// -----------------------------------------------------------
// TrackingSection
// -----------------------------------------------------------
//
// Add a txid to the colour-tracked list, and the list itself.
//
// Used by:
//   - ControlPanel (below)
// -----------------------------------------------------------

function TrackingSection({ transactions, onAdd, onRemove, busy }) {

  const [txid, setTxid] = useState('');
  const [color, setColor] = useState('green');


  const add = () => {
    onAdd({ txid: txid.trim(), color });
    setTxid('');
  };


  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 'bold' }}>
        Transakcijų Sekimas
      </Typography>

      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          placeholder="Įveskite transakcijos ID..."
          value={txid}
          onChange={(event) => setTxid(event.target.value)}
          variant="outlined"
          size="small"
          sx={{ mb: 1 }}
        />

        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <ColorSelect value={color} onChange={setColor} />

          <Button
            variant="contained"
            onClick={add}
            disabled={!txid.trim() || busy}
            startIcon={<MdAdd />}
            size="small"
          >
            Pridėti
          </Button>
        </Box>
      </Box>

      <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
        Sekamos Transakcijos ({transactions.length})
      </Typography>

      {transactions.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          Nesekama nei viena transakcija
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {transactions.map((transaction) => (
            <TrackedTransaction
              key={transaction.txid}
              transaction={transaction}
              onRemove={onRemove}
              busy={busy}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}







// -----------------------------------------------------------
// ControlPanel (default export)
// -----------------------------------------------------------
//
// Used by:
//   - Page.jsx — the sliding panel on the right
// -----------------------------------------------------------

export default function ControlPanel({
  isPanelOpen, onClose, panelWidth, isConnectedToPublic, onConnectionToggle,
  onSendRawTransaction, transactions, onAddTransaction, onRemoveTransaction,
  networkStatus, busy,
}) {
  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        top: 0,
        right: isPanelOpen ? 0 : '-100%',
        width: panelWidth,
        height: '100vh',
        p: 2,
        zIndex: 1000,
        overflow: 'auto',
        transition: 'right 0.3s ease-in-out',
        backgroundColor: 'white',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          Valdymo Skydas
        </Typography>
        <IconButton onClick={onClose} size="small" sx={{ color: 'text.secondary' }}>
          <MdClose />
        </IconButton>
      </Box>

      <ConnectionSection
        isConnectedToPublic={isConnectedToPublic}
        onConnectionToggle={onConnectionToggle}
        busy={busy}
        networkStatus={networkStatus}
      />

      <Divider sx={{ mb: 2 }} />

      <RawTransactionForm onSend={onSendRawTransaction} busy={busy} />

      <Divider sx={{ mb: 3 }} />

      <TrackingSection
        transactions={transactions}
        onAdd={onAddTransaction}
        onRemove={onRemoveTransaction}
        busy={busy}
      />
    </Paper>
  );
}
