// -----------------------------------------------------------
//  [*] BitcoinScript — how things move
//
//  The playground's few movements in one place, so the same
//  thing moves the same way wherever it happens: a value
//  drops onto the stack, a new coin pops into being, and a
//  lock that held shudders.
//
//  Each is a ready piece of MUI styling. Every one of them
//  stands still for a visitor who has asked for no motion —
//  what moved is then simply there.
//
//  Used by:
//    - components/StackView.jsx, Transactions.jsx, Pieces.jsx
// -----------------------------------------------------------

import { keyframes } from '@mui/material/styles';


// What every movement adds for a visitor who wants none
const STILL = { '@media (prefers-reduced-motion: reduce)': { animation: 'none' } };

// A value arriving from above, with a little bounce
const dropIn = keyframes`
  0% { opacity: 0; transform: translateY(-36px) scale(0.92); }
  60% { opacity: 1; transform: translateY(4px) scale(1.02); }
  100% { opacity: 1; transform: none; }
`;

// Something that appears on the spot
const popIn = keyframes`
  0% { opacity: 0; transform: scale(0.5); }
  70% { opacity: 1; transform: scale(1.12); }
  100% { opacity: 1; transform: none; }
`;

// A refusal
const shudder = keyframes`
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-7px) rotate(-2deg); }
  40% { transform: translateX(6px) rotate(2deg); }
  60% { transform: translateX(-4px) rotate(-1deg); }
  80% { transform: translateX(3px); }
`;







// -----------------------------------------------------------
// MOTION
// -----------------------------------------------------------
//
// The movements, each as the styling that plays it once —
// after a wait, where one is given, during which the thing
// is not yet there.
//
// Used by:
//   - the components named in the file header
// -----------------------------------------------------------

export const MOTION = {
  drop: (wait = 0) => ({ animation: `${dropIn} 420ms cubic-bezier(0.2, 0.9, 0.3, 1.1) ${wait}ms both`, ...STILL }),
  pop: (wait = 0) => ({ animation: `${popIn} 340ms ease-out ${wait}ms both`, ...STILL }),
  shake: (wait = 0) => ({ animation: `${shudder} 480ms ease-in-out ${wait}ms both`, ...STILL }),
};
