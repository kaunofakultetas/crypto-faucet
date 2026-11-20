// -----------------------------------------------------------
//  [*] BitcoinScript — More
//
//  What a first lock does not need, behind one button, so the
//  page opens without it: the other things a node looks at
//  besides the scripts, and the switches that break a
//  transaction on purpose.
//
//    - time — transaction B's lock time, and how high the
//      node's chain stands; a lock time above the chain keeps
//      B out of the next block
//    - the coin — whether another transaction has spent it
//      already, which makes B a double spend
//    - the signatures — frozen as they are now, instead of
//      made anew after every change: change B afterwards and
//      it carries signatures of a transaction that no longer
//      exists
//    - the redeem script — a third script, for a lock that
//      holds only a script's hash
//
//  A scene that is about one of these opens the drawer by
//  itself.
//
//  Split into (root component last):
//
//    WholeField   — a field for a whole number
//    More         — the button and the drawer (default export)
// -----------------------------------------------------------

import { useState } from 'react';
import { Button, FormControlLabel, Switch, TextField } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AddIcon from '@mui/icons-material/Add';

import { problemText } from '../narration';







// -----------------------------------------------------------
// WholeField
// -----------------------------------------------------------
//
// A small field for a whole number. What is typed is kept as
// typed; when it is no whole number the field turns red and
// says why under itself.
//
// Used by:
//   - More (below) — the lock time and the chain's height
// -----------------------------------------------------------

function WholeField({ label, text, read, onChange }) {
  return (
    <TextField
      label={label}
      size="small"
      value={text}
      error={read.problem !== null}
      helperText={read.problem ? problemText({ code: read.problem }) : null}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 12 } }}
      sx={{ width: 210 }}
    />
  );
}







// -----------------------------------------------------------
// More (default export)
// -----------------------------------------------------------
//
// The button that opens the drawer, and the drawer: the two
// numbers of time, the two switches, and — while the redeem
// script is not on the page yet — the button that brings it.
// With the signatures frozen the drawer says what that means,
// and once any of them is out of date, that too, with a
// button that signs again. `startOpen` opens the drawer from
// the start.
//
// Used by:
//   - Page.jsx — under the stage
// -----------------------------------------------------------

export default function More({ state, model, rows, change, freeze, thaw, startOpen = false }) {

  // Whether the drawer is open
  const [open, setOpen] = useState(startOpen);

  const { frozen, stale } = model.signing;

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
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <WholeField label="Transakcijos B nLockTime" text={state.lockTime} read={model.b.lockTime} onChange={(text) => change({ type: 'lock-time', text })} />
            <WholeField label="Grandinės aukštis" text={state.height} read={model.height} onChange={(text) => change({ type: 'height', text })} />

            <FormControlLabel
              control={<Switch checked={state.coinSpent} onChange={(event) => change({ type: 'coin-spent', value: event.target.checked })} />}
              label="Monetą jau išleido kita transakcija"
            />
            <FormControlLabel
              control={<Switch checked={frozen} onChange={(event) => (event.target.checked ? freeze() : thaw())} />}
              label="Užšaldyti parašus"
            />

            {!rows.redeemShown && (
              <Button variant="outlined" startIcon={<AddIcon />} onClick={rows.openRedeem} sx={{ textTransform: 'none' }}>
                Pridėti išpirkimo skriptą
              </Button>
            )}
          </div>

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
