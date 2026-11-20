// -----------------------------------------------------------
//  [*] BitcoinScript — useStepper
//
//  Where the page stands in the node's run of the scripts.
//  The run itself is already done — the model holds every
//  step of it — so "running" it is only moving a cursor along
//  the steps: one at a time by hand, back as freely as
//  forward, straight to any step, or by itself at reading
//  pace.
//
//  A cursor belongs to the steps it was moved on. The moment
//  the page is handed other steps — every change the student
//  makes builds new ones — the cursor stands at their END and
//  nothing is playing, in that very render. So the page
//  always shows how the scripts as they are built right now
//  fare: drop a tile into a script and the stack, and the
//  verdict, are the new ones at once. Going back through the
//  steps is then a matter of pressing play, or of pressing a
//  word of the script.
//
//  The stepper also says HOW the cursor got where it is: by
//  one step forward, or any other way. Only the first is a
//  thing happening — a value landing on the stack — and only
//  then does the page move things; arriving any other way it
//  just shows the state.
// -----------------------------------------------------------

import { useEffect, useState } from 'react';

import { PLAY_MS } from '../constants';







// -----------------------------------------------------------
// useStepper (default export)
// -----------------------------------------------------------
//
// Takes the steps to walk through (playback.js picks them
// out of the node's timeline) and hands back the cursor —
// minus one before the first step, otherwise the number of
// the step the node is at — that step itself and the one
// before it, whether the cursor is past the start, at the
// end, or moving by itself, whether it got here by a single
// step forward, and the moves. Playing always starts from
// the first step. Without steps — a transaction that cannot
// be built yet — nothing moves.
//
// Used by:
//   - Page.jsx
// -----------------------------------------------------------

export default function useStepper(steps) {

  // The cursor, with the steps it counts in
  const [held, setHeld] = useState({ steps: null, cursor: -1, playing: false, stepped: false });

  const last = steps ? steps.length - 1 : -1;
  const current = held.steps === steps;
  const cursor = current ? held.cursor : last;
  const playing = current && held.playing;
  const finished = last >= 0 && cursor === last;


  // Playing: one step after each pause, until the end
  useEffect(() => {
    if (!playing) return undefined;
    if (cursor >= last) {
      setHeld({ steps, cursor, playing: false, stepped: false });
      return undefined;
    }
    const pause = setTimeout(() => setHeld({ steps, cursor: cursor + 1, playing: true, stepped: true }), PLAY_MS);
    return () => clearTimeout(pause);
  }, [playing, cursor, last, steps]);


  const move = (to) => {
    const target = Math.max(-1, Math.min(to, last));
    setHeld({ steps, cursor: target, playing: false, stepped: target === cursor + 1 });
  };


  return {
    cursor,
    last,
    entry: steps?.[cursor] ?? null,
    previous: steps?.[cursor - 1] ?? null,
    started: cursor >= 0,
    finished,
    playing,
    stepped: current && held.stepped,
    next: () => move(cursor + 1),
    back: () => move(cursor - 1),
    jump: move,
    play: () => {
      if (last >= 0) setHeld({ steps, cursor: 0, playing: true, stepped: true });
    },
    pause: () => setHeld({ steps, cursor, playing: false, stepped: false }),
  };
}
