// -----------------------------------------------------------
//  [*] BitcoinScript — ScriptLine
//
//  The scripts, as the line of tiles they are built in. On a
//  wide screen it really is one line: what the input of
//  transaction B brings — its unlocking script, its witness,
//  or both, one under the other — then the lock of the coin
//  picked on transaction A: the order a node goes through
//  them. Under them, each once there is a use for it, stand
//  the scripts a lock only holds a trace of: the redeem
//  script, the witness script, the two scripts of a Taproot
//  key — and the script a node builds itself for a coin paid
//  to a witness key hash, which can be read but not changed.
//
//  Everything is done to the tiles themselves:
//
//    - a tile carried in from the tray lands where it is
//      dropped; a tile already in a script can be carried to
//      another place, into another script, or back onto the
//      tray, which takes it out
//    - a press on a tile moves the node there: the stack
//      under the scripts shows what that word left behind
//      (a word the node never got to has nothing to show)
//    - the cross on a tile's corner takes the tile out
//    - on the keyboard, Delete takes the tile out and Shift
//      with an arrow moves it along its script
//
//  A burgundy bar marks where a piece is about to land: under
//  the pointer while one is carried, and otherwise at the end
//  of the script in use — the one a piece pressed in the tray
//  goes to. A press anywhere on a script makes it that one.
//
//  Split into (root component last):
//
//    CARET        — the bar that marks a landing place
//    OWN_WORDS    — the two pieces a script is used by
//    RowHeading   — a row's name and where it comes from
//    ScriptTile   — one word of a script
//    ScriptRow    — one script
//    FixedRow     — a script that is only read
//    OwnPieces    — a script, as pieces for the other rows
//    ScriptLine   — the scripts (default export)
// -----------------------------------------------------------

import { useEffect, useRef } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import { PHASES, looseLabel } from '../narration';
import { phaseOf, stopAt } from '../playback';
import { withWordMoved, withoutWord } from '../tiles';
import Tile, { PaletteTile, TileCross } from './Tile';


// The bar that marks where a piece is about to land — a
// little taller than the tiles it stands between
const CARET = 'w-1 rounded-full bg-[var(--color-primary)]';

// The two words that stand for a script in the other rows, by
// the script's row: the script itself, which the input hands
// over, and what the lock holds of it — its hash, or, for a
// Taproot script, the proof that the lock's key hides it
const OWN_WORDS = {
  redeem: ['<redeemScript>', '<scriptHash>'],
  witnessScript: ['<witnessScript>', '<witnessHash>'],
  leafA: ['<leafA>', '<controlA>'],
  leafB: ['<leafB>', '<controlB>'],
};







// -----------------------------------------------------------
// RowHeading
// -----------------------------------------------------------
//
// The top of a row: its name — with the name Bitcoin texts
// know it by for a tooltip, where the row goes by a Lithuanian
// one — where it comes from, and whatever the row puts beside
// them.
//
// Used by:
//   - ScriptRow, FixedRow (below)
// -----------------------------------------------------------

function RowHeading({ name, children }) {
  const { known } = PHASES[name];
  const title = <h2 className="text-sm font-bold text-slate-900">{PHASES[name].name}</h2>;

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
      {known === null ? title : <Tooltip describeChild title={`Bitcoin tekstuose šis skriptas vadinamas ${known}.`} arrow placement="top-start">{title}</Tooltip>}
      <span className="text-xs text-slate-600">{PHASES[name].from}</span>
      {children}
    </div>
  );
}







// -----------------------------------------------------------
// ScriptTile
// -----------------------------------------------------------
//
// One word of a script: a tile that can be pressed, carried
// and — by the cross on its corner, or the Delete key — taken
// out. Shift with an arrow moves it one place along. While it
// is being carried the tile left behind is faded. The cross
// is in sight under the pointer or the keyboard, and also on
// the word the node stands at while nobody is playing the
// check, which is what a touched screen has for a pointer.
//
// Used by:
//   - ScriptRow (below)
// -----------------------------------------------------------

function ScriptTile({ tile, carried, crossShown, onLift, onDragEnd, onJump, onRemove, onMove }) {
  const placed = ['current', 'skipping', 'failed'].includes(tile.step);

  const onKeyDown = (event) => {
    if (event.key === 'Delete' || event.key === 'Backspace') onRemove(event, true);
    else if (event.shiftKey && event.key === 'ArrowLeft') onMove(event, -1);
    else if (event.shiftKey && event.key === 'ArrowRight') onMove(event, 1);
  };

  return (
    <span className={`group relative flex max-w-full ${carried ? 'opacity-30' : ''}`}>
      <button
        type="button"
        draggable
        data-tile
        aria-label={tile.label.text}
        aria-current={placed ? 'step' : undefined}
        onClick={onJump}
        onKeyDown={onKeyDown}
        onDragStart={onLift}
        onDragEnd={onDragEnd}
        className="flex max-w-full cursor-grab rounded-md focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-[var(--color-primary)] active:cursor-grabbing"
      >
        <Tile label={tile.label} step={tile.step} />
      </button>
      <TileCross label={`Išimti: ${tile.label.text}`} onClick={onRemove} shown={crossShown} />
    </span>
  );
}







// -----------------------------------------------------------
// ScriptRow
// -----------------------------------------------------------
//
// One script — or the witness, which is built the same way:
// its heading, a button that empties it, and its words as
// tiles in a wrapping row. The whole of it takes a carried
// tile — the bar shows the gap it would land in — and a press
// on any of it makes it the row in use, which shows the bar
// at its end. An empty row says what to do with it. `stopOf`
// says which stop of the check a word belongs to.
//
// After a tile is moved or taken out with the keys the
// keyboard stays where it was: on the moved tile, or on the
// one that took the place of the tile taken out.
//
// Used by:
//   - ScriptLine (below)
// -----------------------------------------------------------

function ScriptRow({ name, tiles, row, inUse, drag, stepper, stopOf, onAim, className = '', children }) {

  // The row's tiles, and the place the keyboard should be at
  // after the next change
  const list = useRef(null);
  const wanted = useRef(null);

  useEffect(() => {
    if (wanted.current === null) return;

    const all = list.current?.querySelectorAll('[data-tile]') ?? [];
    all[Math.min(wanted.current, all.length - 1)]?.focus();
    wanted.current = null;
  });

  const over = drag.over?.row === name;
  const caret = drag.held ? (over ? drag.over.gap : null) : inUse ? tiles.length : null;
  const jump = (index) => () => {
    const stop = stopOf(index);
    if (stop >= 0) stepper.jump(stop);
  };

  const remove = (index) => (event, byKey = false) => {
    event.preventDefault();
    if (byKey) wanted.current = index;
    row.set(withoutWord(row.text, index));
  };

  const move = (index) => (event, by) => {
    event.preventDefault();
    if (index + by < 0 || index + by >= tiles.length) return;

    wanted.current = index + by;
    row.set(withWordMoved(row.text, index, by > 0 ? index + 2 : index - 1));
  };

  return (
    <div
      data-row={name}
      data-in-use={inUse}
      onClick={() => onAim(name)}
      onFocus={() => onAim(name)}
      onDragOver={drag.hover(name)}
      onDragLeave={drag.leave(name)}
      onDrop={(event) => {
        drag.drop(name)(event);
        onAim(name);
      }}
      className={`flex min-w-0 flex-col gap-2 rounded-lg border-2 bg-slate-50 px-3 pb-3 pt-2 transition-colors ${over ? 'border-[var(--color-primary)] bg-white' : 'border-slate-300'} ${className}`}
    >
      <RowHeading name={name}>
        {children}
        {tiles.length > 0 && (
          <Tooltip title={name === 'witness' ? 'Išvalyti witness' : 'Išvalyti skriptą'} arrow>
            <IconButton size="small" aria-label={`Išvalyti: ${PHASES[name].name}`} onClick={() => row.set('')} sx={{ ml: children ? 0 : 'auto' }}>
              <BackspaceOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </RowHeading>

      <ol ref={list} aria-label={PHASES[name].name} className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-3">
        {tiles.map((tile, index) => (
          <li key={tile.key} data-slot className="relative flex max-w-full">
            {caret === index && <span aria-hidden="true" data-caret className={`absolute -bottom-1 -left-[6px] -top-1 ${CARET}`} />}
            {caret === tiles.length && index === tiles.length - 1 && <span aria-hidden="true" data-caret className={`absolute -bottom-1 -right-[7px] -top-1 ${CARET}`} />}
            <ScriptTile
              tile={tile}
              carried={drag.held?.from?.row === name && drag.held.from.index === index}
              crossShown={tile.step === 'current' && !stepper.playing}
              onLift={drag.lift(tile.word.text, { row: name, index })}
              onDragEnd={drag.end}
              onJump={jump(index)}
              onRemove={remove(index)}
              onMove={move(index)}
            />
          </li>
        ))}
        {caret === 0 && tiles.length === 0 && <li aria-hidden="true" data-caret className={`h-9 ${CARET}`} />}
        {tiles.length === 0 && <li className="text-sm text-slate-500">Tempk detales čia</li>}
      </ol>
    </div>
  );
}







// -----------------------------------------------------------
// FixedRow
// -----------------------------------------------------------
//
// A script nobody builds: the node makes it itself, so its
// words can be pressed — the cursor goes to that word — but
// not carried, moved or taken out. Its frame is dashed to
// say so.
//
// Used by:
//   - ScriptLine (below) — the script behind a witness key
//     hash
// -----------------------------------------------------------

function FixedRow({ name, tiles, stepper, stopOf }) {
  const jump = (index) => () => {
    const stop = stopOf(index);
    if (stop >= 0) stepper.jump(stop);
  };

  return (
    <div data-row={name} className="flex min-w-0 flex-col gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-3 pb-3 pt-2">
      <RowHeading name={name} />
      <ol aria-label={PHASES[name].name} className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-3">
        {tiles.map((tile, index) => (
          <li key={tile.key} className="flex max-w-full">
            <button
              type="button"
              data-tile
              aria-label={tile.label.text}
              aria-current={['current', 'skipping', 'failed'].includes(tile.step) ? 'step' : undefined}
              onClick={jump(index)}
              className="flex max-w-full cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-[var(--color-primary)]"
            >
              <Tile label={tile.label} step={tile.step} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}







// -----------------------------------------------------------
// OwnPieces
// -----------------------------------------------------------
//
// A script as the two pieces the other rows use it by: the
// script itself, which the input hands over, and what the
// lock holds of it. They are on offer right at the script
// they stand for. A press on one sends it to the row in use,
// without making this script that one — neither the press nor
// the keyboard arriving on a piece is passed on to the row
// around them.
//
// Used by:
//   - ScriptLine (below) — beside the name of a script that
//     stands behind a hash or a Taproot key
// -----------------------------------------------------------

function OwnPieces({ name, lexicon, drag, onPick }) {
  return (
    <span
      role="group"
      aria-label={`${PHASES[name].name} kaip detalės`}
      className="ml-auto flex flex-wrap items-center gap-1.5"
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => event.stopPropagation()}
    >
      <span className="text-xs text-slate-600">Šis skriptas kaip detalės</span>
      {OWN_WORDS[name].map((word) => <PaletteTile key={word} word={word} label={looseLabel(word, lexicon)} drag={drag} onPick={onPick} />)}
    </span>
  );
}







// -----------------------------------------------------------
// ScriptLine (default export)
// -----------------------------------------------------------
//
// What B's input brings and the lock side by side — one under
// the other on a narrow screen — with an arrow from what a
// node takes first to what it goes to next, and under them
// the scripts behind a hash or a key, each while it is shown,
// in the order a node gets to them. The tiles come ready
// (playback.js): each word with its name and the node's place
// at it.
//
// Used by:
//   - Page.jsx — the top of the stage
// -----------------------------------------------------------

export default function ScriptLine({ tapes, rows, stepper, stops, model }) {
  const { shown } = rows;
  const stopOf = (name) => (index) => stopAt(stops, phaseOf(name, model.b.shown), index);
  const row = (name) => ({
    name,
    tiles: tapes[name],
    row: rows.rows[name],
    inUse: rows.target === name,
    drag: rows.drag,
    stepper,
    stopOf: stopOf(name),
    onAim: rows.aimAt,
  });
  const behind = (name) => (
    <ScriptRow {...row(name)}>
      <OwnPieces name={name} lexicon={model.lexicon} drag={rows.drag} onPick={rows.pick} />
    </ScriptRow>
  );

  return (
    <section aria-label="Skriptai" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch">
        <div className="flex min-w-0 flex-col gap-3 xl:min-w-[260px] xl:max-w-[55%] xl:shrink-0">
          {shown.unlock && <ScriptRow {...row('unlock')} className="xl:flex-1" />}
          {shown.witness && <ScriptRow {...row('witness')} className="xl:flex-1" />}
        </div>
        <ArrowForwardIcon aria-hidden="true" className="!hidden self-center text-slate-400 xl:!block" />
        <ScriptRow {...row('lock')} className="xl:flex-1" />
      </div>
      {shown.redeem && behind('redeem')}
      {shown.program && <FixedRow name="program" tiles={tapes.program} stepper={stepper} stopOf={stopOf('program')} />}
      {shown.witnessScript && behind('witnessScript')}
      {shown.leaves && behind('leafA')}
      {shown.leaves && behind('leafB')}
    </section>
  );
}
