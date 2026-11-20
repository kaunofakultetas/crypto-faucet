// -----------------------------------------------------------
//  [*] BitcoinScript — PieceTray
//
//  The one tray everything a script is built from lies in,
//  at the side of the stage. From the top, in the order a
//  first lock needs them:
//
//    - the key pairs — under each one's name its three
//      pieces: a signature, the public key and that key's
//      hash. A press on the name opens what the pair really
//      is — private key, public key, hash, address — where
//      it can be renamed or removed; a button under the list
//      makes a new pair
//    - the opcodes — the handful a first lock is built from
//      and the smallest numbers; every other opcode is behind
//      one press, by family and with a search
//    - data — a field that takes a number, a text or bytes
//      and offers it as a piece the moment it is typed, plain
//      and hashed; what was once taken stays on a small shelf
//
//  Every piece here behaves the same: the mouse carries it
//  into a script, and a press sends it to the end of the
//  script in use.
//
//  The tray also takes tiles back. A tile carried out of a
//  script and dropped anywhere on the tray is taken out of
//  the script — while one is in hand the tray says so.
//
//  Split into (root component last):
//
//    FIELD        — the look of the tray's two typing fields
//    Section      — a titled part of the tray
//    WordTile     — a word on offer, named by what it is
//    KeyDetails   — what a key pair is, and its name
//    KeyRow       — one key pair and its three pieces
//    Keys         — the key pairs
//    Opcodes      — the opcodes and the numbers
//    Offer        — a piece of data just typed
//    DataMaker    — the field that makes data
//    Data         — the shelf and the maker
//    PieceTray    — the tray (default export)
// -----------------------------------------------------------

import { useState } from 'react';
import { Button, Popover, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { LIMITS } from '../constants';
import { labelOf, looseLabel, problemText } from '../narration';
import { COMMON_WORDS, HASHES, SMALL_NUMBERS, drawersWith, keyWords, makeHash, makeWord } from '../tiles';
import { KeyBadge } from './Pieces';
import { PaletteTile, TileCross } from './Tile';


// The look of a field something is typed into on the tray
const FIELD = 'w-full rounded-md border-2 border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-[var(--color-primary)] focus:outline-none';







// -----------------------------------------------------------
// Section
// -----------------------------------------------------------
//
// A part of the tray under its one-word title.
//
// Used by:
//   - Keys, Opcodes, Data (below)
// -----------------------------------------------------------

function Section({ title, children }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}







// -----------------------------------------------------------
// WordTile
// -----------------------------------------------------------
//
// A word on offer as a tile, named the way the word would be
// named in a script.
//
// Used by:
//   - KeyRow, Opcodes, Data (below)
// -----------------------------------------------------------

function WordTile({ word, lexicon, rows, brief = false }) {
  return <PaletteTile word={word} label={looseLabel(word, lexicon)} brief={brief} drag={rows.drag} onPick={rows.pick} />;
}







// -----------------------------------------------------------
// KeyDetails
// -----------------------------------------------------------
//
// What a key pair is, in the order one thing is made from the
// other: the private key, the public key, its hash and the
// address — each written out in full — above them the name,
// which can be changed, and below them the button that
// removes the pair. The last pair left cannot be removed.
//
// Used by:
//   - KeyRow (below) — what opens under a pair's name
// -----------------------------------------------------------

function KeyDetails({ pair, removable, change }) {
  const facts = [
    ['Privatus raktas', pair.privateKey],
    ['Viešasis raktas', pair.publicKey],
    ['Viešojo rakto maiša (HASH160)', pair.publicKeyHash],
    ['Adresas', pair.address],
  ];

  return (
    <div className="flex w-[min(400px,92vw)] flex-col gap-3 p-4">
      <TextField
        label="Pavadinimas"
        size="small"
        value={pair.name}
        onChange={(event) => change({ type: 'key/rename', id: pair.id, name: event.target.value })}
        slotProps={{ htmlInput: { maxLength: LIMITS.NAME_CHARACTERS } }}
      />

      <dl className="flex flex-col gap-2">
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt className="text-xs font-semibold text-slate-600">{term}</dt>
            <dd className="break-all font-mono text-xs text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      <Button variant="outlined" color="error" size="small" disabled={!removable} onClick={() => change({ type: 'key/remove', id: pair.id })} sx={{ textTransform: 'none', alignSelf: 'flex-start' }}>
        Pašalinti raktų porą
      </Button>
    </div>
  );
}







// -----------------------------------------------------------
// KeyRow
// -----------------------------------------------------------
//
// One key pair: its badge and name — a button that opens the
// pair's details — and under them its three pieces, without
// the name on each, since it stands right above.
//
// Used by:
//   - Keys (below)
// -----------------------------------------------------------

function KeyRow({ pair, lexicon, removable, rows, change }) {

  // The button the details hang from, while they are open
  const [anchor, setAnchor] = useState(null);

  return (
    <li className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-label={`Raktų pora „${pair.name}“`}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(event.currentTarget)}
        className="flex w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1.5 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
      >
        <KeyBadge name={pair.name} colour={pair.colour} size={22} />
        <span className="truncate text-sm font-bold" style={{ color: pair.colour }}>{pair.name || '(be pavadinimo)'}</span>
        <ExpandMoreIcon aria-hidden="true" className="text-slate-400" sx={{ fontSize: 18 }} />
      </button>

      <div className="flex flex-wrap gap-1.5">
        {keyWords(pair.id).map((word) => <WordTile key={word} word={word} lexicon={lexicon} rows={rows} brief />)}
      </div>

      <Popover open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <KeyDetails pair={pair} removable={removable} change={change} />
      </Popover>
    </li>
  );
}







// -----------------------------------------------------------
// Keys
// -----------------------------------------------------------
//
// The key pairs, each with its pieces, and the button that
// makes one more — gone once the tray holds as many as it
// may.
//
// Used by:
//   - PieceTray (below)
// -----------------------------------------------------------

function Keys({ model, rows, change, addKey }) {
  return (
    <Section title="Raktų poros">
      <ul className="flex flex-col gap-3">
        {model.keys.map((pair) => (
          <KeyRow key={pair.id} pair={pair} lexicon={model.lexicon} removable={model.keys.length > 1} rows={rows} change={change} />
        ))}
      </ul>

      {model.keys.length < LIMITS.KEYS && (
        <Button variant="text" size="small" startIcon={<AddIcon />} onClick={addKey} sx={{ textTransform: 'none', alignSelf: 'flex-start' }}>
          Sukurti raktų porą
        </Button>
      )}
    </Section>
  );
}







// -----------------------------------------------------------
// Opcodes
// -----------------------------------------------------------
//
// The opcodes a first lock is built from and the smallest
// numbers, always on show; and behind "Visi opkodai" every
// opcode there is, family by family, under a field that
// narrows them by name. The long list scrolls inside the
// tray, so the key pairs above it stay in reach.
//
// Used by:
//   - PieceTray (below)
// -----------------------------------------------------------

function Opcodes({ lexicon, rows }) {

  // Whether every opcode is on show, and what narrows them
  const [all, setAll] = useState(false);
  const [search, setSearch] = useState('');

  const drawers = all ? drawersWith(search) : [];

  return (
    <Section title="Opkodai">
      <div className="flex flex-wrap gap-1.5">
        {COMMON_WORDS.map((word) => <WordTile key={word} word={word} lexicon={lexicon} rows={rows} />)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SMALL_NUMBERS.map((word) => <WordTile key={word} word={word} lexicon={lexicon} rows={rows} />)}
      </div>

      <Button
        variant="text"
        size="small"
        aria-expanded={all}
        endIcon={all ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onClick={() => setAll(!all)}
        sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
      >
        Visi opkodai
      </Button>

      {all && (
        <div className="flex flex-col gap-2">
          <input type="search" aria-label="Ieškoti opkodo" placeholder="Ieškoti opkodo" value={search} maxLength={30} onChange={(event) => setSearch(event.target.value)} className={FIELD} />

          <div className="flex max-h-[340px] flex-col gap-3 overflow-y-auto py-1 pr-1">
            {drawers.length === 0 && <p className="text-sm text-slate-600">Tokio opkodo nėra.</p>}
            {drawers.map((drawer) => (
              <div key={drawer.key} role="group" aria-label={drawer.title} className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-slate-600">{drawer.title}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {drawer.words.map((word) => <WordTile key={word} word={word} lexicon={lexicon} rows={rows} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}







// -----------------------------------------------------------
// Offer
// -----------------------------------------------------------
//
// A piece of data just typed, on offer like any other tile —
// carried into a script, or sent there by a press — with one
// thing more: the moment it is taken either way, it is put on
// the shelf, so it can be taken again and, when it is a hash,
// is known everywhere by how it was made.
//
// Used by:
//   - DataMaker (below)
// -----------------------------------------------------------

function Offer({ word, label, rows, onKeep }) {
  const drag = {
    lift: rows.drag.lift,
    end: () => {
      rows.drag.end();
      onKeep();
    },
  };
  const pick = (picked) => {
    onKeep();
    rows.pick(picked);
  };

  return <PaletteTile word={word} label={label} drag={drag} onPick={pick} />;
}







// -----------------------------------------------------------
// DataMaker
// -----------------------------------------------------------
//
// The field data is made in. What is typed says by itself
// what it is — digits a number, 0x and hex digits bytes,
// anything else a text — and is offered at once as a piece,
// and beside the chosen hash function as the hash of that
// piece. What cannot be made says why. A piece that is
// already on the shelf is not offered a second time.
//
// Used by:
//   - Data (below)
// -----------------------------------------------------------

function DataMaker({ state, lexicon, rows, change }) {

  // What is typed, and the hash function on offer
  const [typed, setTyped] = useState('');
  const [algorithm, setAlgorithm] = useState('SHA-256');

  const plain = makeWord(typed);
  const hashed = makeHash(algorithm, typed);
  const kept = (word) => state.data.some((piece) => piece.word === word);
  const hashLabel = hashed.word && labelOf(hashed.word.slice(2), { keys: lexicon.keys, values: new Map([[hashed.word.slice(2), { what: 'hash', ...hashed.made }]]) });

  return (
    <div className="flex flex-col gap-2">
      <input
        aria-label="Nauji duomenys"
        placeholder="Skaičius, tekstas arba 0x baitai"
        value={typed}
        maxLength={80}
        onChange={(event) => setTyped(event.target.value)}
        className={FIELD}
      />

      {typed.trim() !== '' && plain.problem && <p role="alert" className="text-xs font-semibold text-red-700">{problemText(plain.problem)}</p>}

      {plain.word && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!kept(plain.word) && <Offer word={plain.word} label={looseLabel(plain.word, lexicon)} rows={rows} onKeep={() => change({ type: 'data/add', word: plain.word })} />}

          <select
            aria-label="Maišos funkcija"
            value={algorithm}
            onChange={(event) => setAlgorithm(event.target.value)}
            className="cursor-pointer rounded-md border-2 border-slate-300 bg-white px-1 py-1 text-xs font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
          >
            {Object.keys(HASHES).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          {!kept(hashed.word) && <Offer word={hashed.word} label={hashLabel} rows={rows} onKeep={() => change({ type: 'data/add', word: hashed.word, made: hashed.made })} />}
        </div>
      )}
    </div>
  );
}







// -----------------------------------------------------------
// Data
// -----------------------------------------------------------
//
// The shelf — every piece of data taken so far, each with a
// cross that throws it away — and under it the field that
// makes more. Throwing a piece off the shelf leaves the
// scripts alone: a script that uses it keeps the word.
//
// Used by:
//   - PieceTray (below)
// -----------------------------------------------------------

function Data({ state, model, rows, change }) {
  return (
    <Section title="Duomenys">
      {state.data.length > 0 && (
        <ul aria-label="Sukurti duomenys" className="flex flex-wrap gap-x-2 gap-y-3 pt-1">
          {state.data.map((piece) => (
            <li key={piece.id} className="group relative flex max-w-full">
              <WordTile word={piece.word} lexicon={model.lexicon} rows={rows} />
              <TileCross label={`Išmesti: ${looseLabel(piece.word, model.lexicon).text}`} onClick={() => change({ type: 'data/remove', id: piece.id })} />
            </li>
          ))}
        </ul>
      )}

      <DataMaker state={state} lexicon={model.lexicon} rows={rows} change={change} />
    </Section>
  );
}







// -----------------------------------------------------------
// PieceTray (default export)
// -----------------------------------------------------------
//
// The tray: key pairs, opcodes, data. While a tile out of a
// script is in hand, the whole tray is covered by a note that
// dropping it here takes it out — and takes the drop.
//
// Used by:
//   - Page.jsx — at the side of the stage
// -----------------------------------------------------------

export default function PieceTray({ state, model, rows, change, addKey, className = '' }) {
  const returning = Boolean(rows.drag.held?.from);

  return (
    <aside aria-label="Detalės" className={`card-surface relative flex flex-col gap-5 p-3.5 ${className}`} {...rows.drag.bin}>
      <Keys model={model} rows={rows} change={change} addKey={addKey} />
      <Opcodes lexicon={model.lexicon} rows={rows} />
      <Data state={state} model={model} rows={rows} change={change} />

      {returning && (
        <div aria-hidden="true" data-bin className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center rounded-[var(--radius-md)] border-2 border-dashed border-slate-500 bg-white/80 p-4 pt-24">
          <span className="flex flex-col items-center gap-2 rounded-lg bg-white px-5 py-4 text-center text-sm font-semibold text-slate-800 shadow-md">
            <DeleteOutlineIcon fontSize="large" />
            Numesk čia, ir detalė bus išimta
          </span>
        </div>
      )}
    </aside>
  );
}
