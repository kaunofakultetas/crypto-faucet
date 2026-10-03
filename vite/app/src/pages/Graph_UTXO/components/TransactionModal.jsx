// -----------------------------------------------------------
//  [*] Graph_UTXO — TransactionModal
//
//  A closer look at one transaction, flying out of the box
//  that was clicked (UniversalModal). On top: whether and
//  where it was mined, the full txid with a copy button, and
//  who sent it. Then the money itself — every input on the
//  left and every output on the right as a card: WHO controls
//  the address (whoever holds its private key — the name the
//  class gave it), the full address with a copy button, the
//  amount, and where the coin came from or went. An input
//  names the earlier output it spends; an output names the
//  transaction that spent it, carries a gold "Neišleista"
//  while nobody has, a grey "Nežinoma" when nobody can say
//  (its address's history was never read), or says it holds
//  data, not coins (OP_RETURN). Every transaction reference is
//  a link: following it walks the chain inside the dialog —
//  past the day on screen too, fetched from the backend on the
//  way — and Atgal walks back. Under the cards the fee is
//  worked out the way the chain does it — inputs minus outputs
//  — with its rate per virtual byte. A coinbase has no inputs
//  and no fee: it makes the block's reward out of nothing.
//
//  Names are edited in place (the pencil beside a name) and
//  stored by the backend: a rename relabels the whole graph, an
//  empty name clears it, Enter saves and Esc drops the edit
//  without closing the dialog; a name the backend did not take
//  keeps the editor open with the reason. While a changed name
//  is unsaved, a backdrop click or the × asks before throwing
//  it away.
//
//  Whatever fails is said with its reason. A transaction that
//  cannot be fetched and a name that was not saved go through
//  requestErrorText: the backend's own sentence — which tells
//  a transaction the node does not know from an Electrum
//  server that could not be asked — else the dialog's with
//  why the request failed. A copy the browser refused says
//  why in its tooltip.
//
//  Split into (root component last):
//
//    PERSON_COLORS    — avatar colours for named people
//    formatTime       — a time in the viewer's own clock
//    avatarOf         — a controller's letter and colour
//    CopyButton       — copy, with the result in the tooltip
//    StatusChip       — mined in block N, waiting, or unknown
//    TxLink           — a txid that opens in the dialog
//    ControllerName   — avatar + name, or the name editor
//    CoinCard         — one input or output
//    NewCoinsCard     — a coinbase's place for inputs
//    SpendNote        — where an output went, if anywhere
//    CoinColumn       — a titled list of cards
//    Figure           — one labelled amount of the fee sum
//    FeeEquation      — inputs − outputs = fee, and the rate
//    FetchState       — on its way, or why it cannot be shown
//    TransactionModal — the dialog (default export)
// -----------------------------------------------------------

import { useRef, useState } from 'react';

import { Avatar, Button, Chip, CircularProgress, IconButton, TextField, Tooltip } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CheckIcon from '@mui/icons-material/Check';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ScheduleIcon from '@mui/icons-material/Schedule';
import TollIcon from '@mui/icons-material/Toll';

import UniversalModal from '@/components/UniversalModal';
import { requestErrorText } from '@/utils/requestError';
import { clipboardFailure } from '@/utils/clipboardError';

import { COLORS, NAME_MAX_LENGTH } from '../constants';
import {
  formatAmount, groupThousands, isChange, nameOf, senderOf, shortTxid, spendStateOf, useTransaction,
} from '../hooks/useTransactionGraph';


// Avatar colours for named people — picked by a hash of the
// NAME, so every address of one person wears the same colour
const PERSON_COLORS = ['#0284c7', '#059669', '#7c3aed', '#ea580c', '#db2777', '#0d9488', '#4f46e5', '#65a30d'];







// -----------------------------------------------------------
// formatTime
// -----------------------------------------------------------
//
// A time the backend sends (ISO, UTC) as the viewer's own
// local date and time in the short Lithuanian form — the same
// clock the student reads the day slider by.
//
// Used by:
//   - TransactionModal (below) — beside the status chip
// -----------------------------------------------------------

const formatTime = (iso) => new Date(iso).toLocaleString('lt-LT', { dateStyle: 'short', timeStyle: 'short' });







// -----------------------------------------------------------
// avatarOf
// -----------------------------------------------------------
//
// A controller's avatar: the name's first letter on a colour
// — the faucet in the brand burgundy, a named person in a
// colour hashed from the name, an unnamed address a grey "?".
// Anything but a string counts as no name, so a broken
// address book can cost a letter, never the dialog.
//
// Used by:
//   - CoinCard (below) — the avatar and the card's left edge
// -----------------------------------------------------------

function avatarOf(name, isFaucet) {

  if (typeof name !== 'string' || !name) {
    return { letter: '?', color: isFaucet ? COLORS.BRAND : COLORS.BORDER };
  }


  const letter = [...name][0].toUpperCase();
  if (isFaucet) {
    return { letter, color: COLORS.BRAND };
  }
  const hash = [...name].reduce((total, char) => (total * 31 + char.codePointAt(0)) >>> 0, 7);
  return { letter, color: PERSON_COLORS[hash % PERSON_COLORS.length] };
}







// -----------------------------------------------------------
// CopyButton
// -----------------------------------------------------------
//
// An icon button copying `text`; its tooltip reports the
// result for 1.5 s — "Nukopijuota!", or why the copy failed,
// worded once for every copy button (clipboardFailure): no
// clipboard outside a secure page, the browser refusing the
// write, or the browser's own words for anything else.
//
// Used by:
//   - TransactionModal (below) — the txid
//   - CoinCard (below) — every address
// -----------------------------------------------------------

function CopyButton({ text, label }) {

  // null, 'ok', or the sentence saying why the copy failed
  const [result, setResult] = useState(null);


  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setResult('ok');
    } catch (error) {
      setResult(`Nepavyko nukopijuoti: ${clipboardFailure(error)}`);
    }
    setTimeout(() => setResult(null), 1500);
  };


  const tip = result === 'ok' ? 'Nukopijuota!' : (result ?? label);

  return (
    <Tooltip title={tip} placement="top">
      <IconButton size="small" onClick={copy} aria-label={label}>
        {result === 'ok' ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}







// -----------------------------------------------------------
// StatusChip
// -----------------------------------------------------------
//
// Whether the transaction is in a block yet: a green
// "Patvirtinta · blokas #N" chip once it is mined, an amber
// "Laukia patvirtinimo (mempool)" while it waits — amber like
// the dashed frame of a waiting box on the graph — and a grey
// "Būsena nežinoma" when no history the backend read lists it
// any more (replaced, or dropped from the mempool).
//
// Used by:
//   - TransactionModal (below) — the first line
// -----------------------------------------------------------

function StatusChip({ status, block }) {

  if (status === 'confirmed') {
    return <Chip icon={<CheckCircleIcon />} label={`Patvirtinta · blokas #${block}`} color="success" variant="outlined" size="small" />;
  }
  if (status === 'mempool') {
    return <Chip icon={<ScheduleIcon />} label="Laukia patvirtinimo (mempool)" color="warning" variant="outlined" size="small" />;
  }

  return (
    <Tooltip title="Nė vieno perskaityto adreso istorijoje šios transakcijos nėra — ji galėjo būti pakeista kita arba išmesta iš mempool">
      <Chip icon={<HelpOutlineIcon />} label="Būsena nežinoma" variant="outlined" size="small" />
    </Tooltip>
  );
}







// -----------------------------------------------------------
// TxLink
// -----------------------------------------------------------
//
// A transaction reference that opens it in this dialog — from
// the day on screen at once, from the backend otherwise.
//
// Used by:
//   - TransactionModal (below) — the input cards' "from"
//   - SpendNote (below) — "spent in"
// -----------------------------------------------------------

function TxLink({ txid, onOpen, children }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(txid)}
      className="cursor-pointer font-mono text-[var(--color-primary)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {children}
    </button>
  );
}







// -----------------------------------------------------------
// ControllerName
// -----------------------------------------------------------
//
// Who controls the address: the avatar and the name (or
// `fallback` — "Nežinomas valdytojas", or what an address-less
// output holds) with a pencil — or, while editing, the name
// field with save / cancel, and why the name was not saved
// under it.
// `editor` comes from TransactionModal's editorFor; null for a
// coin with no address, which nobody can name.
//
// Used by:
//   - CoinCard (below)
// -----------------------------------------------------------

function ControllerName({ name, fallback, avatar, editor }) {

  if (editor?.isEditing) {
    return (
      <div className="flex min-w-0 flex-1 items-start gap-1">
        <TextField
          size="small"
          autoFocus
          value={editor.draft}
          disabled={editor.saving}
          error={Boolean(editor.error)}
          helperText={editor.error}
          placeholder="Kas valdo šį adresą?"
          onChange={(event) => editor.onDraft(event.target.value.slice(0, NAME_MAX_LENGTH))}
          onKeyDown={(event) => {
            // Enter saves and Esc drops the edit — neither may
            // reach the dialog, where Esc would close it
            if (event.key === 'Enter') {
              event.preventDefault();
              editor.onSave();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              editor.onCancel();
            }
          }}
          slotProps={{ htmlInput: { maxLength: NAME_MAX_LENGTH, 'aria-label': 'Valdytojo vardas' } }}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <IconButton size="small" color="primary" onClick={editor.onSave} disabled={editor.saving} aria-label="Išsaugoti vardą">
          {editor.saving ? <CircularProgress size={16} /> : <CheckIcon fontSize="small" />}
        </IconButton>
        <IconButton size="small" onClick={editor.onCancel} disabled={editor.saving} aria-label="Atšaukti">
          <CloseIcon fontSize="small" />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Avatar sx={{ width: 30, height: 30, fontSize: 14, fontWeight: 700, bgcolor: avatar.color }}>
        {avatar.letter}
      </Avatar>
      {name
        ? <span className="truncate font-semibold text-slate-800">{name}</span>
        : <span className="italic text-slate-400">{fallback}</span>}
      {editor && (
        <Tooltip title="Keisti valdytojo vardą">
          <IconButton size="small" onClick={editor.onEdit} aria-label="Keisti valdytojo vardą">
            <EditOutlinedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}







// -----------------------------------------------------------
// CoinCard
// -----------------------------------------------------------
//
// One input or output: the controller, the amount, the full
// address with a copy button — or, for a coin with no address,
// `note` saying why — and, on the last line, `children`: where
// the coin came from or went. The left edge wears the
// controller's colour, so one person's coins line up at a
// glance.
//
// Used by:
//   - TransactionModal (below) — one per input and output
// -----------------------------------------------------------

function CoinCard({ coin, name, fallback, note, isFaucet, unit, editor, children }) {

  const avatar = avatarOf(name, isFaucet);


  return (
    <li
      className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
      style={{ borderLeft: `4px solid ${avatar.color}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <ControllerName name={name} fallback={fallback} avatar={avatar} editor={editor} />
        <div className="shrink-0 pt-1 text-right font-semibold tabular-nums text-slate-900">
          {formatAmount(coin.value)} <span className="text-xs font-normal text-slate-500">{unit}</span>
        </div>
      </div>

      {coin.address ? (
        <div className="mt-2 flex items-center gap-1 rounded-lg bg-slate-50 py-0.5 pl-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-slate-600">{coin.address}</code>
          <CopyButton text={coin.address} label="Kopijuoti adresą" />
        </div>
      ) : (
        <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs italic text-slate-500">{note}</div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {children}
      </div>
    </li>
  );
}







// -----------------------------------------------------------
// NewCoinsCard
// -----------------------------------------------------------
//
// A coinbase's inputs column: no coin is spent — the block's
// miner is paid with new coins, the block subsidy plus the
// fees of the block's transactions.
//
// Used by:
//   - TransactionModal (below) — instead of input cards
// -----------------------------------------------------------

function NewCoinsCard() {
  return (
    <li className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
      <b className="text-slate-800">Naujos monetos.</b> Coinbase transakcija nieko neišleidžia: ja bloko kasėjas
      gauna atlygį — bloko subsidiją ir bloko transakcijų mokesčius.
    </li>
  );
}







// -----------------------------------------------------------
// SpendNote
// -----------------------------------------------------------
//
// An output's last line, by its state (spendStateOf): the
// transaction that spent it as a link, the gold "Neišleista
// (UTXO)", the grey "Nežinoma, ar išleista" with the reason on
// hover, or that OP_RETURN data holds no coin to spend.
//
// Used by:
//   - TransactionModal (below) — one per output card
// -----------------------------------------------------------

function SpendNote({ output, onOpen }) {

  const state = spendStateOf(output);


  if (state === 'spent') {
    return (
      <>
        Išleista transakcijoje
        <TxLink txid={output.spent_by.txid} onOpen={onOpen}>{shortTxid(output.spent_by.txid)}</TxLink>
      </>
    );
  }
  if (state === 'unspent') {
    return (
      <Chip
        icon={<TollIcon />}
        label="Neišleista (UTXO)"
        size="small"
        sx={{ bgcolor: '#fef3c7', color: COLORS.COIN_EDGE, '& .MuiChip-icon': { color: COLORS.COIN } }}
      />
    );
  }
  if (state === 'data') {
    return <Chip label="Duomenys — išleisti negalima" size="small" variant="outlined" />;
  }

  return (
    <Tooltip title="Šio adreso istorija neskaityta: jis per toli nuo čiaupo arba tai viešas adresas su labai ilga istorija">
      <Chip icon={<HelpOutlineIcon />} label="Nežinoma, ar išleista" size="small" variant="outlined" />
    </Tooltip>
  );
}







// -----------------------------------------------------------
// CoinColumn
// -----------------------------------------------------------
//
// One side of the money: the small-caps title ("Įvestys" or
// "Išvestys") with the number of cards beside it, and the
// cards stacked under it.
//
// Used by:
//   - TransactionModal (below) — Įvestys and Išvestys
// -----------------------------------------------------------

function CoinColumn({ title, count, children }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        {title}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{count}</span>
      </h3>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}







// -----------------------------------------------------------
// Figure
// -----------------------------------------------------------
//
// One term of the fee sum: a small-caps label over the amount
// and its unit. `strong` marks the result — the fee — larger
// and in the brand colour.
//
// Used by:
//   - FeeEquation (below) — each term of the sum
// -----------------------------------------------------------

function Figure({ label, value, unit, strong = false }) {
  return (
    <div className="text-center">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`tabular-nums ${strong ? 'text-lg font-bold text-[var(--color-primary)]' : 'font-semibold text-slate-800'}`}>
        {value} <span className="text-xs font-normal text-slate-500">{unit}</span>
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// FeeEquation
// -----------------------------------------------------------
//
// The fee as the chain knows it — no transaction states its
// fee; it is whatever the inputs hold beyond the outputs —
// and, when the size is known, its rate per virtual byte,
// the number miners sort the mempool by. A coinbase pays no
// fee, and with an input's amount unknown there is no sum to
// show — each gets a sentence instead.
//
// Used by:
//   - TransactionModal (below) — under the cards
// -----------------------------------------------------------

function FeeEquation({ tx, unit }) {

  if (tx.coinbase || tx.fee === null) {
    return (
      <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600">
        {tx.coinbase
          ? 'Coinbase transakcija mokesčio nemoka — ji pati yra kasėjo atlygis.'
          : 'Mokesčio apskaičiuoti negalima: nežinoma, kiek verta bent viena įvestis.'}
      </p>
    );
  }


  const fee = tx.fee;
  const totalIn = tx.inputs.reduce((total, input) => total + input.value, 0);
  const totalOut = tx.outputs.reduce((total, output) => total + output.value, 0);
  const rate = tx.vsize ? (fee / tx.vsize).toLocaleString('lt-LT', { maximumFractionDigits: 2 }) : null;

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-linear-to-br from-slate-50 to-white p-4">
      <div className="flex flex-wrap items-end justify-center gap-x-5 gap-y-2">
        <Figure label="Įvestys" value={formatAmount(totalIn)} unit={unit} />
        <span className="pb-0.5 text-xl text-slate-400">−</span>
        <Figure label="Išvestys" value={formatAmount(totalOut)} unit={unit} />
        <span className="pb-0.5 text-xl text-slate-400">=</span>
        <Figure label="Mokestis kasėjui" value={formatAmount(fee)} unit={unit} strong />
      </div>

      {rate && (
        <p className="mt-3 text-center text-xs text-slate-500">
          Mokesčio tarifas: {groupThousands(fee)} sat ÷ {groupThousands(tx.vsize)} vB = <b className="text-slate-700">{rate} sat/vB</b>.
        </p>
      )}
    </div>
  );
}







// -----------------------------------------------------------
// FetchState
// -----------------------------------------------------------
//
// The body while the transaction on show is not at hand:
// "Kraunama…" with a spinner only while it is on its way.
// Once the fetch is over without a transaction — refused,
// failed, or answered with none — the dialog says why: the
// backend's own sentence word for word (it tells a
// transaction the node does not know, a 404, from an
// Electrum server that could not be asked or would not give
// it), else the dialog's sentence with the reason after it.
// Waiting is never what is left over, so no answer, however
// broken, can keep the dialog loading for ever.
//
// Used by:
//   - TransactionModal (below) — instead of the transaction
// -----------------------------------------------------------

function FetchState({ fetched }) {

  if (fetched.isPending) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
        <CircularProgress size={16} color="inherit" />
        Kraunama…
      </div>
    );
  }

  return (
    <p className="py-10 text-center text-sm text-red-700">
      {requestErrorText(fetched.error, 'Nepavyko gauti transakcijos.')}
    </p>
  );
}







// -----------------------------------------------------------
// TransactionModal (default export)
// -----------------------------------------------------------
//
// Mounted while a transaction is open and unmounted by
// onClose, which UniversalModal calls only after the return
// flight — so every opening starts fresh at `txid`.
// sourceRect is the clicked box's screen rectangle, the
// flight's origin. A transaction of the day on screen comes
// from transactionsById (and follows its polling: a waiting
// one turns confirmed in place); any other is fetched with the
// names of its addresses, and the dialog says so while it
// loads or when it cannot be had (FetchState). renameAddress
// is the data hook's: it settles once a name is stored and
// rejects with the request's error when it was not.
//
// Used by:
//   - UtxoFlowGraph.jsx — on a box's click or Enter / Space
// -----------------------------------------------------------

export default function TransactionModal({ network, txid, sourceRect, onClose, transactionsById, names, renameAddress, faucetAddress, unit }) {

  const closeRef = useRef(null);
  const [trail, setTrail] = useState([txid]);
  const [editing, setEditing] = useState(null);

  const current = trail[trail.length - 1];
  const known = transactionsById[current];
  const fetched = useTransaction(network, current, !known);
  const tx = known ?? fetched.data?.transaction ?? null;
  const shownNames = known ? names : { ...names, ...fetched.data?.names };

  // An address's name, or null — the cards, the avatars and
  // the name editor read names only through here, and only
  // text counts, as everywhere in the drawing (nameOf)
  const nameAt = (address) => {
    const name = address ? shownNames[address] : null;
    return typeof name === 'string' && name ? name : null;
  };
  const dirty = Boolean(editing) && editing.draft.trim() !== (nameAt(editing.address) ?? '');


  // Walking the chain: a linked transaction opens in place and
  // Atgal returns — an unsaved rename stays behind
  const openTx = (next) => {
    setEditing(null);
    setTrail((trailNow) => [...trailNow, next]);
  };

  const back = () => {
    setEditing(null);
    setTrail((trailNow) => trailNow.slice(0, -1));
  };


  // One card's name editor; `key` tells apart two rows of the
  // same address (change returns to an input's address). A
  // save waits for the backend: the editor closes once the
  // name is stored, and stays open with the reason if not —
  // the backend's refusal, or why the request failed
  const editorFor = (key, address) => ({
    isEditing: editing?.key === key,
    draft: editing?.key === key ? editing.draft : '',
    saving: editing?.key === key && editing.saving,
    error: editing?.key === key ? editing.error : null,
    onEdit: () => setEditing({ key, address, draft: nameAt(address) ?? '', saving: false, error: null }),
    onDraft: (draft) => setEditing((edit) => ({ ...edit, draft, error: null })),
    onSave: async () => {
      const draft = editing?.draft ?? '';
      setEditing((edit) => ({ ...edit, saving: true, error: null }));
      let failure = null;
      try {
        await renameAddress(address, draft);
      } catch (error) {
        failure = requestErrorText(error, 'Nepavyko išsaugoti vardo.');
      }
      setEditing((edit) => {
        if (edit?.key !== key) return edit;
        return failure ? { ...edit, saving: false, error: failure } : null;
      });
    },
    onCancel: () => setEditing(null),
  });


  return (
    <UniversalModal
      open
      onClose={onClose}
      closeRef={closeRef}
      sourceRect={sourceRect}
      title="Transakcija"
      maxWidth={940}
      fullWidth
      dirty={dirty}
      actions={
        <div className="flex items-center justify-between">
          {trail.length > 1 ? (
            <Button variant="text" startIcon={<ArrowBackIcon />} onClick={back}>
              Atgal
            </Button>
          ) : <span />}
          <Button variant="contained" onClick={() => closeRef.current?.()}>
            Uždaryti
          </Button>
        </div>
      }
    >
      {!tx ? <FetchState fetched={fetched} /> : (
        <>
          {/* Status, the full txid, the sender */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={tx.status} block={tx.block} />
            {tx.time && <span className="text-sm text-slate-500">{formatTime(tx.time)}</span>}
          </div>

          <div className="mt-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-3 pr-1">
            <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-slate-700">{tx.txid}</code>
            <CopyButton text={tx.txid} label="Kopijuoti transakcijos ID" />
          </div>

          {!tx.coinbase && (
            <p className="mt-3 text-sm text-slate-600">
              Siuntėjas: <b className="text-slate-900">{senderOf(tx, shownNames).label}</b>
              {senderOf(tx, shownNames).several && ' — įvestis pasirašė skirtingi žmonės; taip atrodo PayJoin ar CoinJoin.'}
            </p>
          )}

          {/* The money: the inputs on the left flow into the
              outputs on the right */}
          <div className="mt-5 grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
            <CoinColumn title="Įvestys" count={tx.inputs.length}>
              {tx.coinbase && <NewCoinsCard />}
              {tx.inputs.map((input, vin) => (
                <CoinCard
                  key={`in-${vin}`}
                  coin={input}
                  name={nameAt(input.address)}
                  fallback={input.address ? 'Nežinomas valdytojas' : 'Nežinomas adresas'}
                  note="Ankstesnės transakcijos serveris negrąžino — nei adresas, nei suma nežinomi"
                  isFaucet={Boolean(input.address) && input.address === faucetAddress}
                  unit={unit}
                  editor={input.address ? editorFor(`in-${vin}`, input.address) : null}
                >
                  Iš išvesties
                  <TxLink txid={input.txid} onOpen={openTx}>{`${shortTxid(input.txid)}:${input.vout}`}</TxLink>
                </CoinCard>
              ))}
            </CoinColumn>

            <div className="hidden self-center text-slate-300 md:block" aria-hidden="true">
              <ArrowForwardIcon fontSize="large" />
            </div>

            <CoinColumn title="Išvestys" count={tx.outputs.length}>
              {tx.outputs.map((output, vout) => (
                <CoinCard
                  key={`out-${vout}`}
                  coin={output}
                  name={nameAt(output.address)}
                  fallback={output.address ? 'Nežinomas valdytojas' : nameOf(null, shownNames, output.script_type)}
                  note={output.script_type === 'op_return'
                    ? 'Adreso nėra — ši išvestis saugo duomenis, ne monetas'
                    : 'Adreso nėra — išvestis užrakinta scenarijumi, kuris adresu neužrašomas'}
                  isFaucet={Boolean(output.address) && output.address === faucetAddress}
                  unit={unit}
                  editor={output.address ? editorFor(`out-${vout}`, output.address) : null}
                >
                  {isChange(tx, output) && <Chip label="Grąža" size="small" variant="outlined" />}
                  <SpendNote output={output} onOpen={openTx} />
                </CoinCard>
              ))}
            </CoinColumn>
          </div>

          <FeeEquation tx={tx} unit={unit} />
        </>
      )}
    </UniversalModal>
  );
}
