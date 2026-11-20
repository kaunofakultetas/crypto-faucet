// -----------------------------------------------------------
//  [*] BitcoinScript — Tile
//
//  The playground's one building block: a word of a script,
//  or a value on the stack, as a tile. Whatever is shown as a
//  tile looks the same wherever it lies — in the tray, in a
//  script being built, on the stack — so a student follows
//  one piece all the way from the tray to the verdict.
//
//  There are two kinds of tile, and the page is built on
//  telling them apart at a glance. A word that DOES something
//  — an opcode — is ink: dark, with white letters. A word
//  that only PUTS something down — data, and the small
//  numbers Script happens to have opcodes for — is paper:
//  white, with dark letters. A script is then read like a
//  sentence, its nouns light and its verbs dark.
//
//  Colour is kept for one thing only: whose a piece of data
//  is. What comes from a key pair carries that pair's colour,
//  a small picture — a pen for a signature, a key for a
//  public key, a fingerprint for a key's hash — the short
//  word Bitcoin texts use for the thing, and the pair's name.
//  A word that does not work is pale and struck through, and
//  one the page cannot read is red.
//
//  On a script that is being run a tile also shows where the
//  node is: behind it and faded, the one it stands on ringed
//  in the site's burgundy, the one it broke at ringed in red,
//  skipped in a branch not taken and struck through.
//
//  Split into (root component last):
//
//    INK, PAPER, BROKEN, UNKNOWN — the looks
//    SIZES, ICON_SIZES — the two sizes
//    STEPS        — the node's place, as a look
//    ICONS        — the pictures of the named kinds
//    Tile         — one word or value (default export)
//    PaletteTile  — a tile on offer (exported)
//    TileCross    — the cross that takes a tile away (exported)
// -----------------------------------------------------------

import { useState } from 'react';
import { Tooltip } from '@mui/material';
import DrawIcon from '@mui/icons-material/Draw';
import KeyIcon from '@mui/icons-material/VpnKey';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import TagIcon from '@mui/icons-material/Tag';
import CloseIcon from '@mui/icons-material/Close';

import { COLORS } from '../constants';


// A word that does something
const INK = 'border-slate-950 bg-slate-800 text-white';

// A word that puts something down
const PAPER = 'border-slate-400 bg-white text-slate-800';

// A word that does not work
const BROKEN = 'border-slate-300 bg-slate-100 text-slate-500 line-through';

// A word the page cannot read
const UNKNOWN = 'border-red-500 bg-red-50 text-red-800';

// A tile's build in each size: medium in a script and in the
// tray, large on the stack. The heavier lower edge is what
// says a tile can be picked up
const SIZES = {
  md: 'gap-1.5 rounded-md border-2 border-b-[3px] px-2.5 py-1 text-sm',
  lg: 'gap-2 rounded-lg border-2 border-b-4 px-3.5 py-1.5 text-base',
};

// The size of a tile's picture, in px
const ICON_SIZES = { md: 16, lg: 19 };

// What a tile adds for the node's place at it
const STEPS = {
  todo: '',
  done: 'opacity-45',
  current: 'shadow-md ring-[3px] ring-[var(--color-primary)] ring-offset-2',
  failed: 'shadow-md ring-[3px] ring-red-600 ring-offset-2',
  skipped: 'opacity-35 line-through',
  skipping: 'opacity-70 line-through ring-2 ring-[var(--color-primary)] ring-offset-1',
};

// The picture in front of a value that has a name
const ICONS = {
  sig: DrawIcon,
  pubkey: KeyIcon,
  pubkeyhash: FingerprintIcon,
  redeemScript: DescriptionIcon,
  scriptHash: FingerprintIcon,
  hash: TagIcon,
};







// -----------------------------------------------------------
// Tile (default export)
// -----------------------------------------------------------
//
// One label as a tile (see the file header for the looks).
// The label is narration.js's: a kind and a text, and for a
// value with a name the short word for what it is, whose it
// is and in which colour; a sentence rides along for the
// tooltip. `step` is the node's place at the tile, in a
// script that is being run; `wide` makes it fill its row, as
// a value on the stack does. A word with something wrong
// about it is outlined in red dashes.
//
// A tile that is pressed puts its tooltip away until the
// pointer comes to it anew: a tile being carried gets no word
// that the pointer has left it, and would otherwise leave its
// tooltip hanging where it was picked up.
//
// Used by:
//   - PaletteTile (below)
//   - components/ScriptLine.jsx — the words of a script
//   - components/StackView.jsx — the values on the stack
// -----------------------------------------------------------

export default function Tile({ label, size = 'md', step = 'todo', wide = false }) {

  // Whether the tile was pressed since the pointer came to it
  const [pressed, setPressed] = useState(false);

  const Icon = ICONS[label.kind];
  const colour = label.colour ?? COLORS.INK;
  const opcode = label.kind === 'op';
  const puts = !opcode || label.group === 'constants';
  const tone = label.kind === 'unknown' ? UNKNOWN : puts ? PAPER : label.state ? BROKEN : INK;
  const prefixed = opcode && label.text.startsWith('OP_');

  return (
    <Tooltip title={pressed ? '' : label.full} arrow placement="top" enterDelay={350}>
      <span
        data-kind={label.kind}
        data-step={step}
        onPointerDown={() => setPressed(true)}
        onPointerEnter={() => setPressed(false)}
        className={`max-w-full select-none items-center whitespace-nowrap font-mono font-bold ${wide ? 'flex w-full justify-center' : 'inline-flex'} ${SIZES[size]} ${tone} ${STEPS[step]} ${label.problem ? 'outline-2 outline-offset-1 outline-dashed outline-red-500' : ''}`}
        style={Icon ? { borderColor: colour, color: colour } : undefined}
      >
        {Icon && <Icon aria-hidden="true" sx={{ fontSize: ICON_SIZES[size] }} />}
        <span className="truncate">
          {Icon && <><span className="font-normal">{label.short}</span>{label.name ? ` ${label.name}` : ''}{label.stale ? ' (senas)' : ''}</>}
          {!Icon && prefixed && <><span className="font-normal opacity-70">OP_</span>{label.text.slice(3)}</>}
          {!Icon && !prefixed && label.text}
        </span>
      </span>
    </Tooltip>
  );
}







// -----------------------------------------------------------
// PaletteTile
// -----------------------------------------------------------
//
// One tile on offer. The mouse carries it into a script, to a
// place of the student's choosing; a press sends it to the
// end of the script in use. `brief` leaves the owner's name
// off the tile — beside a key pair's own name it is already
// said — while a screen reader still hears it.
//
// Used by:
//   - components/PieceTray.jsx — the key pairs' pieces, the
//     opcodes and the data
//   - components/ScriptLine.jsx — the redeem script's own two
//     pieces
// -----------------------------------------------------------

export function PaletteTile({ word, label, brief = false, drag, onPick }) {
  return (
    <button
      type="button"
      draggable
      aria-label={`Įdėti: ${label.text}`}
      onClick={() => onPick(word)}
      onDragStart={drag.lift(word)}
      onDragEnd={drag.end}
      className="flex max-w-full cursor-grab rounded-md transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] active:translate-y-0.5 active:cursor-grabbing"
    >
      <Tile label={brief ? { ...label, name: null } : label} />
    </button>
  );
}







// -----------------------------------------------------------
// TileCross
// -----------------------------------------------------------
//
// The small round cross on a tile's corner that takes the
// tile away. It keeps out of sight until the pointer is over
// the tile or the keyboard is on it, so a script at rest is
// only its words; `shown` puts it there regardless — for a
// screen that is touched, where nothing hovers. Whatever
// holds the tile has to be the group the cross answers to,
// and the frame it is placed in.
//
// Used by:
//   - components/ScriptLine.jsx — a word taken out of a script
//   - components/PieceTray.jsx — a piece of data thrown away
// -----------------------------------------------------------

export function TileCross({ label, onClick, shown = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`absolute -right-2.5 -top-2.5 z-10 h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-slate-700 text-white shadow hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] group-focus-within:flex group-hover:flex ${shown ? 'flex' : 'hidden'}`}
    >
      <CloseIcon aria-hidden="true" sx={{ fontSize: 15 }} />
    </button>
  );
}
