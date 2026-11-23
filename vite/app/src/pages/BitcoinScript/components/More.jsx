// -----------------------------------------------------------
//  [*] BitcoinScript — More
//
//  What a first lock does not need, behind one button, so the
//  page opens without it: the other things a node looks at
//  besides the scripts, and the switches that break a
//  transaction on purpose.
//
//    - time — transaction B's lock time and the sequence
//      number of its input, the height of the node's chain
//      and the block that holds transaction A. A lock time
//      above the chain keeps B out of the next block; a
//      sequence number that asks for a wait keeps it out
//      until the coin is that many blocks old. Under the two
//      fields that take some reading stands what they come
//      to: what the sequence number promises, and how many
//      confirmations the coin has
//    - the coin — whether another transaction has spent it
//      already, which makes B a double spend
//    - the signatures — the moment of signing frozen, instead
//      of every key signing anew after every change: change B
//      afterwards and it carries signatures of a transaction
//      that no longer exists
//    - the rows of the script line a scene has no use for,
//      and so does not show: the witness, a redeem script, a
//      witness script, the scripts of a Taproot key
//
//  A scene that is about one of these opens the drawer by
//  itself.
//
//  Split into (root component last):
//
//    EXTRA_ROWS   — the rows that can be asked for
//    NumberField  — a field for a number, with what it means
//    More         — the button and the drawer (default export)
// -----------------------------------------------------------

import { useState } from 'react';
import { Button, FormControlLabel, Switch, TextField } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AddIcon from '@mui/icons-material/Add';

import { ageText, problemText, sequenceMeaning } from '../narration';


// The rows of the script line that can be asked for, by the
// name hooks/useScriptRows.js knows each by, with what the
// button that brings it says
const EXTRA_ROWS = [
  ['unlock', 'Pridėti atrakinimo skriptą'],
  ['witness', 'Pridėti witness'],
  ['redeem', 'Pridėti išpirkimo skriptą'],
  ['witnessScript', 'Pridėti witness script'],
  ['leaves', 'Pridėti tapscript A ir B'],
];







// -----------------------------------------------------------
// NumberField
// -----------------------------------------------------------
//
// A small field for a number. What is typed is kept as typed;
// when it is no number the field turns red and says why under
// itself. Otherwise the line under it is free for a hint —
// what the number comes to — and an empty field can show what
// it stands for by itself.
//
// Used by:
//   - More (below) — the four numbers of time
// -----------------------------------------------------------

function NumberField({ label, text, read, hint = null, placeholder, onChange }) {
  return (
    <TextField
      label={label}
      size="small"
      value={text}
      placeholder={placeholder}
      error={read.problem !== null}
      helperText={read.problem ? problemText({ code: read.problem }) : hint}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { maxLength: 12 }, inputLabel: { shrink: true } }}
      sx={{ width: 232 }}
    />
  );
}







// -----------------------------------------------------------
// More (default export)
// -----------------------------------------------------------
//
// The button that opens the drawer, and the drawer: the four
// numbers of time, the two switches, and a button for every
// row of the script line that is not on the page yet — the
// witness, the scripts that stand behind a hash, the Taproot
// scripts — which brings that row.
// An empty sequence number is the one the transaction needs
// by itself, shown faintly in its field. With the signatures
// frozen the drawer says what that means, and once any of
// them is out of date, that too, with a button that signs
// again. `startOpen` opens the drawer from the start.
//
// Used by:
//   - Page.jsx — under the stage
// -----------------------------------------------------------

export default function More({ state, model, rows, change, freeze, thaw, startOpen = false }) {

  // Whether the drawer is open
  const [open, setOpen] = useState(startOpen);

  const { frozen, stale } = model.signing;
  const { sequence, typedSequence, lockTime } = model.b;

  return (
    <section aria-label="Daugiau nustatymų" className="flex flex-col gap-2">
      <Button
        variant="text"
        aria-expanded={open}
        endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onClick={() => setOpen(!open)}
        sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
      >
        Daugiau nustatymų
      </Button>

      {open && (
        <div className="card-surface flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
            <NumberField label="Transakcijos B nLockTime" text={state.lockTime} read={lockTime} onChange={(text) => change({ type: 'lock-time', text })} />
            <NumberField
              label="Įvesties nSequence"
              text={state.sequence}
              read={typedSequence}
              hint={sequenceMeaning(sequence)}
              placeholder={`0x${sequence.toString(16)}`}
              onChange={(text) => change({ type: 'sequence', text })}
            />
            <NumberField label="Grandinės aukštis" text={state.height} read={model.height} onChange={(text) => change({ type: 'height', text })} />
            <NumberField
              label="Transakcijos A blokas"
              text={state.mined}
              read={model.mined}
              hint={model.confirmations === null ? null : ageText(model.confirmations)}
              onChange={(text) => change({ type: 'mined', text })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <FormControlLabel
              control={<Switch checked={state.coinSpent} onChange={(event) => change({ type: 'coin-spent', value: event.target.checked })} />}
              label="Monetą jau išleido kita transakcija"
            />
            <FormControlLabel
              control={<Switch checked={frozen} onChange={(event) => (event.target.checked ? freeze() : thaw())} />}
              label="Užšaldyti parašus"
            />

          </div>
          {EXTRA_ROWS.some(([name]) => !rows.shown[name]) && (
            <div className="flex flex-wrap items-center gap-2">
              {EXTRA_ROWS.filter(([name]) => !rows.shown[name]).map(([name, label]) => (
                <Button key={name} variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => rows.open(name)} sx={{ textTransform: 'none' }}>
                  {label}
                </Button>
              ))}
            </div>
          )}

          {frozen && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-700">
              <p className="max-w-[80ch]">
                {stale.length > 0
                  ? 'Transakcija B pakeista po pasirašymo: jos parašai pasirašė ankstesnę transakciją ir nebetinka.'
                  : 'Parašai lieka tokie, kokie yra dabar. Pakeisk transakciją B — sumą, gavėją ar išleidžiamą monetą — ir jie nebetiks.'}
              </p>
              {stale.length > 0 && (
                <Button variant="outlined" size="small" onClick={freeze} sx={{ textTransform: 'none' }}>Pasirašyti iš naujo</Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
