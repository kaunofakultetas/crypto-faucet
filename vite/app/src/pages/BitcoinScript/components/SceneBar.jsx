// -----------------------------------------------------------
//  [*] BitcoinScript — SceneBar
//
//  The top of the page: its title, the scenes, and the two
//  buttons that make everything on the page safe to try.
//
//  The scenes are a row of buttons, one or two words each,
//  from the simplest lock to the hardest. A press loads the
//  scene whole; the one in use is filled in. Under them is
//  the scene's one sentence — the only running text on the
//  page. The buttons are a group, not a navigation: they go
//  nowhere, and the site's navbar stays the one landmark of
//  that kind.
//
//  "Atšaukti" takes the last change back, and "Iš naujo"
//  loads the scene afresh. With those two in reach nothing a
//  student does can be a mistake that matters.
//
//  Split into:
//
//    SceneBar     — the bar (default export)
// -----------------------------------------------------------

import { Button, IconButton, Tooltip } from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

import { EXAMPLES } from '../examples';







// -----------------------------------------------------------
// SceneBar (default export)
// -----------------------------------------------------------
//
// The title, the scene buttons, undo and restart, and the
// sentence of the scene in use. Loading a scene replaces
// everything that was built, key pairs included.
//
// Used by:
//   - Page.jsx — the top of the page
// -----------------------------------------------------------

export default function SceneBar({ example, canUndo, onLoad, onUndo, onRestart }) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <h1 className="text-2xl font-bold text-[var(--color-primary)]">Bitcoin skriptų žaidimų aikštelė</h1>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip title="Atšaukti paskutinį pakeitimą">
            <span>
              <IconButton aria-label="Atšaukti" disabled={!canUndo} onClick={onUndo}><UndoIcon /></IconButton>
            </span>
          </Tooltip>
          <Button variant="outlined" startIcon={<RestartAltIcon />} onClick={onRestart} sx={{ textTransform: 'none', bgcolor: 'background.paper' }}>Iš naujo</Button>
        </div>
      </div>

      <div role="group" aria-label="Scenos">
        <ul className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((scene) => (
            <li key={scene.id}>
              <button
                type="button"
                aria-pressed={scene.id === example.id}
                onClick={() => onLoad(scene.id)}
                className={`cursor-pointer rounded-full border-2 px-3.5 py-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${scene.id === example.id ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'}`}
              >
                {scene.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="max-w-[120ch] text-pretty text-sm text-slate-700">{example.about}</p>
    </header>
  );
}
