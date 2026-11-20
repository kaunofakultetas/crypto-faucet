// -----------------------------------------------------------
//  [*] BitcoinScript — useTileDrag
//
//  Carrying a tile with the mouse: out of the tray into a
//  script's row, along a row to another place in it, or from
//  one row into another. The browser does the carrying — its
//  own drag and drop — and this hook keeps track of two
//  things while it lasts: which tile is in hand, and which
//  gap of which row the pointer is over, so the row can show
//  where the tile would land.
//
//  A drop becomes one change of a script's text: a word put
//  in, moved, or taken from one script and put into another
//  (tiles.js). A tile carried out of its row and dropped back
//  on the tray is simply taken out of the script — the way
//  anyone tries to throw a tile away.
//
//  The tile in hand is noted at once, for the drop to read,
//  but the page is only told a moment later: a browser takes
//  its picture of the dragged tile as the drag starts, and a
//  tile that fades in that same instant would be carried
//  faded.
//
//  Split into:
//
//    gapAt        — the gap of a row under the pointer
//    useTileDrag  — the hook (default export)
// -----------------------------------------------------------

import { useRef, useState } from 'react';

import { wordsOf } from '../engine/script';
import { withWord, withWordMoved, withoutWord } from '../tiles';







// -----------------------------------------------------------
// gapAt
// -----------------------------------------------------------
//
// Which gap of a row of tiles a point is over, counting from
// zero in front of the first tile. The tiles may wrap onto
// several lines: a point above a line belongs in front of
// that line's first tile, a point on a line in front of the
// first tile whose middle is to its right, and a point past
// everything behind the last tile.
//
// Used by:
//   - useTileDrag (below) — while a tile is over a row
// -----------------------------------------------------------

function gapAt(row, x, y) {
  const slots = [...row.querySelectorAll('[data-slot]')];

  for (const [index, slot] of slots.entries()) {
    const box = slot.getBoundingClientRect();
    if (y < box.top) return index;
    if (y <= box.bottom && x < box.left + box.width / 2) return index;
  }
  return slots.length;
}







// -----------------------------------------------------------
// useTileDrag (default export)
// -----------------------------------------------------------
//
// Takes the rows by name — each with its script's text and
// the way to set it — and hands back what a tile and a row
// need to take part in a drag: `lift` for a tile being picked
// up (with where it came from when it came from a row),
// `hover`, `leave` and `drop` for a row, `bin` for the tray
// — what makes it take back a tile carried out of a row —
// and `end` for a drag that is over. `held` is the tile in
// hand and `over` the row and gap under the pointer, for
// drawing.
//
// Used by:
//   - hooks/useScriptRows.js
// -----------------------------------------------------------

export default function useTileDrag(rows) {

  // The tile in hand: read by the drop, shown by the page
  const carried = useRef(null);
  const [held, setHeld] = useState(null);

  // The row and gap under the pointer
  const [over, setOver] = useState(null);


  const end = () => {
    carried.current = null;
    setHeld(null);
    setOver(null);
  };


  return {
    held,
    over,
    end,

    lift: (word, from = null) => (event) => {
      event.dataTransfer.setData('text/plain', word);
      event.dataTransfer.effectAllowed = from ? 'move' : 'copy';
      carried.current = { word, from };
      setTimeout(() => setHeld(carried.current), 0);
    },

    hover: (name) => (event) => {
      if (!carried.current) return;

      event.preventDefault();
      const gap = gapAt(event.currentTarget, event.clientX, event.clientY);
      if (over?.row !== name || over.gap !== gap) setOver({ row: name, gap });
    },

    leave: (name) => (event) => {
      if (over?.row === name && !event.currentTarget.contains(event.relatedTarget)) setOver(null);
    },

    bin: {
      onDragOver: (event) => {
        if (carried.current?.from) event.preventDefault();
      },
      onDrop: (event) => {
        const tile = carried.current;
        if (!tile?.from) return;

        event.preventDefault();
        rows[tile.from.row].set(withoutWord(rows[tile.from.row].text, tile.from.index));
        end();
      },
    },

    drop: (name) => (event) => {
      const tile = carried.current;
      if (!tile) return;

      event.preventDefault();
      const gap = over?.row === name ? over.gap : wordsOf(rows[name].text).length;

      if (tile.from?.row === name) {
        rows[name].set(withWordMoved(rows[name].text, tile.from.index, gap));
      } else {
        if (tile.from) rows[tile.from.row].set(withoutWord(rows[tile.from.row].text, tile.from.index));
        rows[name].set(withWord(rows[name].text, gap, tile.word));
      }
      end();
    },
  };
}
