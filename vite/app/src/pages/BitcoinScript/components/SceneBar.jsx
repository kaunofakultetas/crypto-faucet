// -----------------------------------------------------------
//  [*] BitcoinScript — SceneBar
//
//  The top of the page: its title, the scenes, and the two
//  buttons that make everything on the page safe to try.
//
//  The scenes come in groups — the locks, Lightning, the
//  swaps between chains — and only one group's scenes are on
//  show at a time, so the row stays a row. The groups' names
//  stand in front of it; a press on one only shows its scenes
//  and changes nothing that was built. A scene's button, one
//  or two words, loads the scene whole; the one in use is
//  filled in. Under the row is what the scene in use shows,
//  in a sentence or two — the only running text on the page.
//  The buttons are groups, not a navigation: they go nowhere,
//  and the site's navbar stays the one landmark of that kind.
//
//  "Atšaukti" takes the last change back, and "Iš naujo"
//  loads the scene afresh. With those two in reach nothing a
//  student does can be a mistake that matters.
//
//  Split into (root component last):
//
//    GroupTabs    — the groups' names
//    SceneBar     — the bar (default export)
// -----------------------------------------------------------

import { useState } from 'react';
import { Button, IconButton, Tooltip } from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

import { EXAMPLES, GROUPS } from '../examples';







// -----------------------------------------------------------
// GroupTabs
// -----------------------------------------------------------
//
// The names of the groups as plain words in a row, the one
// whose scenes are on show underlined in the site's burgundy.
// They look unlike the scenes' rounded buttons on purpose: a
// press here loads nothing.
//
// Used by:
//   - SceneBar (below)
// -----------------------------------------------------------

function GroupTabs({ shown, onShow }) {
  return (
    <div role="group" aria-label="Scenų grupės" className="flex flex-wrap items-center gap-x-1">
      {GROUPS.map((group) => (
        <button
          key={group.key}
          type="button"
          aria-pressed={group.key === shown}
          onClick={() => onShow(group.key)}
          className={`cursor-pointer border-b-2 px-2 py-1 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${group.key === shown ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          {group.title}
        </button>
      ))}
    </div>
  );
}







// -----------------------------------------------------------
// SceneBar (default export)
// -----------------------------------------------------------
//
// The title, undo and restart, the groups with the scenes of
// the one on show, and the text of the scene in use. Loading
// a scene replaces everything that was built, key pairs
// included. The group on show is the one a press chose — and
// with every scene loaded (`visit` counts them) it is again
// the group of the scene in use.
//
// Used by:
//   - Page.jsx — the top of the page
// -----------------------------------------------------------

export default function SceneBar({ example, visit, canUndo, onLoad, onUndo, onRestart }) {

  // The group a press chose, with the visit it was chosen in
  const [chosen, setChosen] = useState({ visit, group: example.group });

  const shown = chosen.visit === visit ? chosen.group : example.group;

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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <GroupTabs shown={shown} onShow={(group) => setChosen({ visit, group })} />

        <div role="group" aria-label="Scenos">
          <ul className="flex flex-wrap gap-1.5">
            {EXAMPLES.filter((scene) => scene.group === shown).map((scene) => (
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
      </div>

      <p className="max-w-[120ch] text-pretty text-sm text-slate-700">{example.about}</p>
    </header>
  );
}
