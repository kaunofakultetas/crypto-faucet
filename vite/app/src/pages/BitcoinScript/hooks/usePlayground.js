// -----------------------------------------------------------
//  [*] BitcoinScript — usePlayground
//
//  The playground's one piece of state and everything worked
//  out from it. The state is the scene that was loaded and
//  whatever the student has built since (model.js says what
//  it holds); the model — the key pairs, both transactions,
//  their problems, the node's verdict with every step — is
//  rebuilt from it on each change and from nothing else, so
//  what the page shows can never drift from what was built.
//
//  Every change can be taken back, one at a time, back to
//  the scene as it was loaded: a place to play in has to be
//  a place where nothing can be broken. What is typed into
//  one field — an amount, a name — counts as one change
//  however many letters it took.
//
//  Nothing is kept beyond the visit: a reload starts from the
//  first scene again, and key pairs made on the page are gone
//  with it.
//
//  Split into:
//
//    HISTORY      — how many changes can be taken back
//    TYPED        — the changes made a letter at a time
//    advance      — the session after one action
//    usePlayground — the hook (default export)
// -----------------------------------------------------------

import { useEffect, useMemo, useReducer } from 'react';

import { freshKey } from '../engine/keys';
import { EXAMPLES, FIRST_EXAMPLE } from '../examples';
import { buildModel, reduce } from '../model';


// How many changes are remembered for taking back
const HISTORY = 100;

// The changes that arrive a letter at a time, each with the
// part of the action that tells one field from another
const TYPED = { 'key/rename': 'id', 'output/amount': 'index', 'payment/amount': 'index', 'lock-time': null, sequence: null, height: null, mined: null };







// -----------------------------------------------------------
// advance
// -----------------------------------------------------------
//
// The session after one action. Loading a scene starts from
// its own state, remembers which scene it was, counts one
// more visit, and forgets what could be taken back. Taking back restores the state
// before the last change. Every other action is a change to
// what is built: it goes to the model's reducer, and the
// state it replaces is kept for taking back — unless the
// reducer changed nothing, or the change is one more letter
// typed into the field the last change was typed into.
//
// Used by:
//   - usePlayground (below)
// -----------------------------------------------------------

function advance(session, action) {
  if (action.type === 'load') return { example: action.example, visit: session.visit + 1, state: action.example.state, past: [], typing: null };

  if (action.type === 'undo') {
    if (session.past.length === 0) return session;
    return { ...session, state: session.past.at(-1), past: session.past.slice(0, -1), typing: null };
  }

  const state = reduce(session.state, action);
  if (state === session.state) return session;

  const typing = action.type in TYPED ? `${action.type}:${action[TYPED[action.type]] ?? ''}` : null;
  const past = typing !== null && typing === session.typing ? session.past : [...session.past, session.state].slice(-HISTORY);
  return { ...session, state, past, typing };
}







// -----------------------------------------------------------
// usePlayground (default export)
// -----------------------------------------------------------
//
// Hands back the scene in use, the number of the visit — one
// more with every scene loaded, so that whatever belongs to
// one visit can start afresh with the next — the state, the
// model built from it, and the ways to change things: `change` takes any
// of the reducer's actions (model.js); `load` swaps in a
// scene by its id and `restart` loads the one in use afresh;
// `undo` takes the last change back — so does Ctrl+Z — and
// `canUndo` says whether there is one; `addKey` draws a new
// private key at random and adds the key pair; `freeze` and
// `thaw` switch between signatures kept as they are now and
// signatures made anew after every change. Freezing puts
// aside transaction B as it stands at that moment — what the
// keys go on signing, whatever B becomes afterwards.
//
// Used by:
//   - Page.jsx
// -----------------------------------------------------------

export default function usePlayground() {

  const [session, dispatch] = useReducer(advance, { example: FIRST_EXAMPLE, visit: 0, state: FIRST_EXAMPLE.state, past: [], typing: null });

  const model = useMemo(() => buildModel(session.state), [session.state]);


  // Ctrl+Z takes the last change back — except in a field,
  // where it belongs to what is being typed
  useEffect(() => {
    const onKey = (event) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z' || typing) return;

      event.preventDefault();
      dispatch({ type: 'undo' });
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);


  return {
    example: session.example,
    visit: session.visit,
    state: session.state,
    model,
    change: dispatch,
    load: (id) => dispatch({ type: 'load', example: EXAMPLES.find((example) => example.id === id) ?? FIRST_EXAMPLE }),
    restart: () => dispatch({ type: 'load', example: session.example }),
    undo: () => dispatch({ type: 'undo' }),
    canUndo: session.past.length > 0,
    addKey: () => dispatch({ type: 'key/add', privateKey: freshKey() }),
    freeze: () => dispatch({ type: 'freeze', signed: model.signing.now }),
    thaw: () => dispatch({ type: 'thaw' }),
  };
}
