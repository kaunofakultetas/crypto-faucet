// -----------------------------------------------------------
//  [*] BitcoinScript — ScriptLine
//
//  The scripts, as the line of tiles they are built in. On a
//  wide screen it really is one line: the unlocking script of
//  transaction B first, then the lock of the coin picked on
//  transaction A — the order a node runs them in, on one
//  stack. Under them, once there is a use for it, stands the
//  redeem script.
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
//    OWN_WORDS    — the redeem script's own two pieces
//    ScriptTile   — one word of a script
//    ScriptRow    — one script
//    RedeemPieces — the redeem script, as pieces for the others
//    ScriptLine   — the scripts (default export)
// -----------------------------------------------------------

import { useEffect, useRef } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import { PHASES, looseLabel } from '../narration';
import { withWordMoved, withoutWord } from '../tiles';
import Tile, { PaletteTile, TileCross } from './Tile';


// The bar that marks where a piece is about to land — a
// little taller than the tiles it stands between
const CARET = 'w-1 rounded-full bg-[var(--color-primary)]';

// The two words that stand for the redeem script in the other
// scripts: the script itself, and its hash
const OWN_WORDS = ['<redeemScript>', '<scriptHash>'];







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
// One script: its name — with the name Bitcoin texts know it
// by for a tooltip — where it lives, a button that empties
// it, and its words as tiles in a wrapping row. The whole of
// it takes a carried tile — the bar shows the gap it would
// land in — and a press on any of it makes it the script in
// use, which shows the bar at its end. An empty script says
// what to do with it.
//
// After a tile is moved or taken out with the keys the
// keyboard stays where it was: on the moved tile, or on the
// one that took the place of the tile taken out.
//
// Used by:
//   - ScriptLine (below)
// -----------------------------------------------------------

function ScriptRow({ name, tiles, row, inUse, drag, stepper, stops, onAim, className = '', children }) {

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
  const stopOf = (index) => stops?.findIndex((entry) => entry.kind === 'item' && entry.phase === name && entry.index === index) ?? -1;

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
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
        <Tooltip describeChild title={`Bitcoin tekstuose šis skriptas vadinamas ${PHASES[name].known}.`} arrow placement="top-start">
          <h2 className="text-sm font-bold text-slate-900">{PHASES[name].name}</h2>
        </Tooltip>
        <span className="text-xs text-slate-600">{PHASES[name].from}</span>
        {children}
        {tiles.length > 0 && (
          <Tooltip title="Išvalyti skriptą" arrow>
            <IconButton size="small" aria-label={`Išvalyti: ${PHASES[name].name}`} onClick={() => row.set('')} sx={{ ml: children ? 0 : 'auto' }}>
              <BackspaceOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </div>

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
// RedeemPieces
// -----------------------------------------------------------
//
// The redeem script as the two pieces the other scripts use
// it by: the script itself, which the unlocking script hands
// over, and its hash, which the lock holds. They are on offer
// right at the script they stand for. A press on one sends it
// to the script in use, without making the redeem script that
// one — neither the press nor the keyboard arriving on a piece
// is passed on to the script around them.
//
// Used by:
//   - ScriptLine (below) — beside the redeem script's name
// -----------------------------------------------------------

function RedeemPieces({ lexicon, drag, onPick }) {
  return (
    <span
      role="group"
      aria-label="Išpirkimo skriptas kaip detalės"
      className="ml-auto flex flex-wrap items-center gap-1.5"
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => event.stopPropagation()}
    >
      <span className="text-xs text-slate-600">Šis skriptas kaip detalės</span>
      {OWN_WORDS.map((word) => <PaletteTile key={word} word={word} label={looseLabel(word, lexicon)} drag={drag} onPick={onPick} />)}
    </span>
  );
}







// -----------------------------------------------------------
// ScriptLine (default export)
// -----------------------------------------------------------
//
// The unlocking script and the lock side by side — one under
// the other on a narrow screen — with an arrow from the one a
// node runs first to the one it runs next, and under them the
// redeem script while it is shown. The tiles come ready
// (playback.js): each word with its name and the node's place
// at it.
//
// Used by:
//   - Page.jsx — the top of the stage
// -----------------------------------------------------------

export default function ScriptLine({ tapes, rows, stepper, stops, lexicon }) {
  const shared = { drag: rows.drag, stepper, stops, onAim: rows.aimAt };

  return (
    <section aria-label="Skriptai" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch">
        <ScriptRow name="unlock" tiles={tapes.unlock} row={rows.rows.unlock} inUse={rows.target === 'unlock'} className="xl:min-w-[260px] xl:max-w-[60%] xl:shrink-0" {...shared} />
        <ArrowForwardIcon aria-hidden="true" className="!hidden self-center text-slate-400 xl:!block" />
        <ScriptRow name="lock" tiles={tapes.lock} row={rows.rows.lock} inUse={rows.target === 'lock'} className="xl:flex-1" {...shared} />
      </div>

      {rows.redeemShown && (
        <ScriptRow name="redeem" tiles={tapes.redeem} row={rows.rows.redeem} inUse={rows.target === 'redeem'} {...shared}>
          <RedeemPieces lexicon={lexicon} drag={rows.drag} onPick={rows.pick} />
        </ScriptRow>
      )}
    </section>
  );
}
