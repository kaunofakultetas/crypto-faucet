// -----------------------------------------------------------
//  [*] BitcoinScript — Transactions
//
//  The two transactions the page is about, as two slim cards
//  with an arrow between them — the whole of what a
//  transaction is here, with nothing to read but amounts.
//
//  Transaction A makes coins: each of its outputs is an
//  orange coin with its amount and a padlock. One of them is
//  the coin transaction B spends — picked with a press, and
//  framed. Transaction B shows that coin going in and the
//  coins it would make coming out, each with the key pair it
//  goes to, and what is left for the miner. B's new coins are
//  dashed outlines until a node accepts B; then they fill,
//  A's coin is the empty ring a spent coin leaves, and its
//  padlock stands open. When the node turns B down the
//  padlock shudders and nothing else changes.
//
//  The arrow carries the verdict in one word. Nothing here is
//  a form: an amount is changed by pressing it, a recipient
//  by choosing another, an output is added with the plus and
//  removed with its cross.
//
//  Split into (root component last):
//
//    STATUS       — the arrow's word and colour, B's frame
//    InlineAmount — an amount that is changed by pressing it
//    CoinChip     — one output of A
//    TransactionA — the card on the left (exported)
//    Arrow        — the arrow with the verdict (exported)
//    TransactionB — the card on the right (exported)
// -----------------------------------------------------------

import { useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import { COLORS, LIMITS } from '../constants';
import { MOTION } from '../motion';
import { formatBitcoin, lockName } from '../narration';
import { Coin, KeyBadge } from './Pieces';


// What the arrow says and how it is drawn, and transaction
// B's frame, by what the node has made of B so far
const STATUS = {
  blocked: { text: 'dar nebaigta', colour: COLORS.MUTED, line: 'dashed', frame: '' },
  unchecked: { text: 'nepatikrinta', colour: COLORS.MUTED, line: 'dashed', frame: '' },
  checking: { text: 'tikrinama', colour: COLORS.MUTED, line: 'dashed', frame: '' },
  valid: { text: 'atrakinta', colour: COLORS.VALID, line: 'solid', frame: 'ring-[3px] ring-emerald-600' },
  invalid: { text: 'atmesta', colour: COLORS.INVALID, line: 'dashed', frame: 'ring-[3px] ring-red-600' },
};

// The look of a small round button on a card
const SMALL = 'flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]';







// -----------------------------------------------------------
// InlineAmount
// -----------------------------------------------------------
//
// An amount of bitcoin that reads as plain text and is
// changed by pressing it: the press turns it into a field
// holding what was typed, and Enter, Escape or a press
// elsewhere turns it back. An amount that cannot be read is
// shown in red, as typed.
//
// Used by:
//   - CoinChip, TransactionB (below)
// -----------------------------------------------------------

function InlineAmount({ name, text, amount, onChange }) {

  // Whether the amount is being typed
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={name}
        value={text}
        inputMode="decimal"
        maxLength={20}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
        }}
        className="w-24 rounded border-2 border-[var(--color-primary)] bg-white px-1 text-sm font-bold text-slate-900 focus:outline-none"
      />
    );
  }

  const shown = amount.value === null ? `${text.trim() || '?'} BTC` : formatBitcoin(amount.value);

  return (
    <Tooltip title="Keisti sumą" arrow>
      <button
        type="button"
        aria-label={`${name}: ${shown}`}
        onClick={() => setEditing(true)}
        className={`cursor-pointer rounded px-1 text-sm font-bold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] ${amount.value === null ? 'text-red-700' : 'text-slate-900'}`}
      >
        {shown}
      </button>
    </Tooltip>
  );
}







// -----------------------------------------------------------
// CoinChip
// -----------------------------------------------------------
//
// One output of transaction A: the coin, its amount and its
// padlock, in a rounded frame. The coin is a radio button —
// picking it makes it the one B spends, and frames it. Only
// the picked coin's amount can be changed, and only it can be
// removed, while A has another. What the coin is locked to is
// the padlock's tooltip and part of the coin's name for a
// screen reader. The padlock follows the verdict on the
// picked coin.
//
// Used by:
//   - TransactionA (below)
// -----------------------------------------------------------

function CoinChip({ output, text, picked, verdict, lexicon, removable, onPick, onAmount, onRemove }) {
  const opened = picked && verdict === 'valid';
  const held = picked && verdict === 'invalid';
  const Padlock = opened ? LockOpenIcon : LockIcon;
  const amount = output.amount.value === null ? '— BTC' : formatBitcoin(output.amount.value);
  const lock = lockName(output.lock, lexicon);

  return (
    <div className={`flex items-center gap-1 rounded-full border-2 bg-white py-0.5 pl-1 pr-2 transition-colors ${picked ? 'border-[var(--color-primary)]' : 'border-slate-200 hover:border-slate-400'}`}>
      <label className="flex cursor-pointer items-center gap-1.5 rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-primary)]">
        <input
          type="radio"
          name="bitcoin-script-coin"
          className="sr-only"
          checked={picked}
          onChange={onPick}
          aria-label={`Išvestis #${output.index}: ${amount}, ${lock}`}
        />
        <Coin size={28} state={opened ? 'spent' : 'unspent'} />
        {!picked && <span className="text-sm font-bold text-slate-700">{amount}</span>}
      </label>

      {picked && <InlineAmount name={`Išvesties #${output.index} suma`} text={text} amount={output.amount} onChange={onAmount} />}

      <Tooltip title={`Užrakinta: ${lock}`} arrow>
        <Box
          component="span"
          key={picked ? verdict : 'idle'}
          aria-hidden="true"
          className="flex"
          sx={{ color: opened ? COLORS.VALID : held ? COLORS.INVALID : COLORS.MUTED, ...(held ? MOTION.shake() : opened ? MOTION.pop() : {}) }}
        >
          <Padlock sx={{ fontSize: 18 }} />
        </Box>
      </Tooltip>

      {picked && removable && (
        <Tooltip title="Pašalinti išvestį" arrow>
          <button type="button" aria-label={`Pašalinti išvestį #${output.index}`} onClick={onRemove} className={SMALL}><CloseIcon sx={{ fontSize: 16 }} /></button>
        </Tooltip>
      )}
    </div>
  );
}







// -----------------------------------------------------------
// TransactionA
// -----------------------------------------------------------
//
// The card of the transaction that makes the coins: its
// outputs as a group of radio buttons, one coin each, and —
// while there is room — a plus for one more.
//
// Used by:
//   - Page.jsx — top left
// -----------------------------------------------------------

export function TransactionA({ state, model, verdict, change }) {
  return (
    <section aria-label="Transakcija A" className="card-surface flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <h2 className="text-sm font-bold text-slate-900">Transakcija A</h2>

      <div role="radiogroup" aria-label="Kurią transakcijos A išvestį išleidžia transakcija B" className="flex flex-wrap items-center gap-2">
        {model.a.outputs.map((output) => (
          <CoinChip
            key={output.id}
            output={output}
            text={state.outputs[output.index].amount}
            picked={output.index === model.b.spends.index}
            verdict={verdict}
            lexicon={model.lexicon}
            removable={model.a.outputs.length > 1}
            onPick={() => change({ type: 'spend', index: output.index })}
            onAmount={(text) => change({ type: 'output/amount', index: output.index, text })}
            onRemove={() => change({ type: 'output/remove', index: output.index })}
          />
        ))}
      </div>

      {model.a.outputs.length < LIMITS.OUTPUTS && (
        <Tooltip title="Pridėti išvestį" arrow>
          <IconButton size="small" aria-label="Pridėti transakcijos A išvestį" onClick={() => change({ type: 'output/add' })}><AddIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
    </section>
  );
}







// -----------------------------------------------------------
// Arrow
// -----------------------------------------------------------
//
// The arrow from the picked coin of A to transaction B, with
// what the node has made of B written on it in one word.
// Between two cards that stand side by side it lies flat; on
// a narrow screen, where B stands under A, it points down.
//
// Used by:
//   - Page.jsx — between the two transactions
// -----------------------------------------------------------

export function Arrow({ verdict }) {
  const { text, colour, line } = STATUS[verdict];
  const stroke = { borderColor: colour, borderStyle: line };

  return (
    <div data-verdict={verdict} className="flex items-center justify-center gap-1 md:w-40" style={{ color: colour }}>
      <span aria-hidden="true" className="hidden h-0 flex-1 border-t-2 md:block" style={stroke} />
      <ArrowDownwardIcon aria-hidden="true" fontSize="small" className="md:!hidden" />
      <span className="rounded-full border-2 bg-white px-3 py-0.5 text-sm font-bold" style={{ borderColor: colour }}>{text}</span>
      <span aria-hidden="true" className="hidden h-0 flex-1 border-t-2 md:block" style={stroke} />
      <ArrowForwardIcon aria-hidden="true" fontSize="small" className="-ml-2.5 !hidden md:!block" />
    </div>
  );
}







// -----------------------------------------------------------
// TransactionB
// -----------------------------------------------------------
//
// The card of the transaction that spends: the coin going in,
// an arrow, and the coins it would make — each with its
// amount, changed by pressing it, and the key pair it goes
// to, changed by choosing another — a plus for one more, a
// cross on each while there is more than one, and what is
// left for the miner or what B is short of — unless one of
// the amounts cannot be read, when there is nothing to count.
// The card is framed green or red once the node has judged B.
//
// Used by:
//   - Page.jsx — top right
// -----------------------------------------------------------

export function TransactionB({ state, model, verdict, change }) {
  const { spends, payments, fee } = model.b;
  const accepted = verdict === 'valid';
  const counted = fee !== null && payments.every((payment) => payment.amount.value !== null);

  return (
    <section aria-label="Transakcija B" className={`card-surface flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 ${STATUS[verdict].frame}`}>
      <h2 className="text-sm font-bold text-slate-900">Transakcija B</h2>

      <Tooltip title={`Įvestis: išleidžia transakcijos A išvestį #${spends.index}`} arrow>
        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-500">
          <Coin size={24} state={accepted ? 'spent' : 'unspent'} />
          {spends.amount.value === null ? '— BTC' : formatBitcoin(spends.amount.value)}
        </span>
      </Tooltip>

      <ArrowForwardIcon aria-hidden="true" fontSize="small" className="text-slate-400" />

      <ul aria-label="Transakcijos B išvestys" className="flex flex-wrap items-center gap-2">
        {payments.map((payment) => (
          <li key={payment.id} className="flex items-center gap-1 rounded-full border-2 border-slate-200 bg-white py-0.5 pl-1 pr-1.5">
            <Coin size={28} state={accepted ? 'unspent' : 'future'} fresh={accepted} />
            <InlineAmount
              name={`Transakcijos B išvesties #${payment.index} suma`}
              text={state.payments[payment.index].amount}
              amount={payment.amount}
              onChange={(text) => change({ type: 'payment/amount', index: payment.index, text })}
            />
            {payment.key && <KeyBadge name={payment.key.name} colour={payment.key.colour} size={20} />}
            <select
              aria-label={`Transakcijos B išvesties #${payment.index} gavėjas`}
              value={payment.to}
              onChange={(event) => change({ type: 'payment/to', index: payment.index, id: Number(event.target.value) })}
              className="max-w-28 cursor-pointer truncate rounded bg-transparent text-sm font-bold focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
              style={{ color: payment.key?.colour }}
            >
              {model.keys.map((pair) => <option key={pair.id} value={pair.id}>{pair.name || '(be pavadinimo)'}</option>)}
            </select>
            {payments.length > 1 && (
              <Tooltip title="Pašalinti išvestį" arrow>
                <button type="button" aria-label={`Pašalinti transakcijos B išvestį #${payment.index}`} onClick={() => change({ type: 'payment/remove', index: payment.index })} className={SMALL}>
                  <CloseIcon sx={{ fontSize: 16 }} />
                </button>
              </Tooltip>
            )}
          </li>
        ))}
      </ul>

      {payments.length < LIMITS.PAYMENTS && (
        <Tooltip title="Pridėti išvestį" arrow>
          <IconButton size="small" aria-label="Pridėti transakcijos B išvestį" onClick={() => change({ type: 'payment/add' })}><AddIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}

      {counted && (
        <p className={`ml-auto text-xs ${fee < 0 ? 'font-bold text-red-700' : 'text-slate-600'}`}>
          {fee < 0 ? `trūksta ${formatBitcoin(-fee)}` : `kasėjui ${formatBitcoin(fee)}`}
        </p>
      )}
    </section>
  );
}
