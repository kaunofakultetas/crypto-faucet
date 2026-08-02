// -----------------------------------------------------------
//  [*] ReorgAttack — BlockNode
//
//  One block in the fork diagram: a card tinted red for the
//  attacker's blocks and blue for the honest chain's, showing
//  the height, hashes, coinbase and time, plus a coin dot per
//  tracked transaction it contains.
//
//  The chain-work bubble is the teaching point — it PULSES on
//  the block with the most accumulated work, i.e. the tip the
//  network currently considers the real chain. Watching that
//  glow jump from the public branch to the attacker's is what
//  a 51% attack looks like.
//
//  Split into (root component last):
//
//    WINNING_BUBBLE_SX — the pulsing/rippling winner styling
//    IDLE_BUBBLE_SX    — the plain styling for every other one
//    TipBadge          — the "Viešas"/"Privatus" tip label
//    BlockNode         — the node itself (default export)
// -----------------------------------------------------------

import { Box, Typography } from '@mui/material';
import { Handle, Position } from 'reactflow';

import { SiHackaday } from 'react-icons/si';
import { BiWorld } from 'react-icons/bi';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';


// Hoisted to module level: these objects (two @keyframes
// blocks among them) used to be rebuilt for every node on
// every 10 s refresh
const WINNING_BUBBLE_SX = {
  bgcolor: 'primary.main',
  border: '2px solid',
  borderColor: 'primary.main',
  boxShadow: '0 0 12px rgba(33, 150, 243, 0.6)',
  animation: 'primaryPulse 2s ease-in-out infinite',
  '@keyframes primaryPulse': {
    '0%': {
      boxShadow: '0 0 8px rgba(33, 150, 243, 0.4), 0 0 16px rgba(33, 150, 243, 0.2)',
      transform: 'scale(1)',
    },
    '50%': {
      boxShadow: '0 0 20px rgba(33, 150, 243, 0.8), 0 0 30px rgba(33, 150, 243, 0.4), 0 0 40px rgba(33, 150, 243, 0.2)',
      transform: 'scale(1.05)',
    },
    '100%': {
      boxShadow: '0 0 8px rgba(33, 150, 243, 0.4), 0 0 16px rgba(33, 150, 243, 0.2)',
      transform: 'scale(1)',
    },
  },
  '&::before': {
    content: '""',
    position: 'absolute',
    top: '-4px',
    left: '-4px',
    right: '-4px',
    bottom: '-4px',
    borderRadius: '16px',
    background: 'rgba(33, 150, 243, 0.1)',
    animation: 'ripple 3s ease-out infinite',
    zIndex: -1,
  },
  '@keyframes ripple': {
    '0%': { transform: 'scale(1)', opacity: 0.6 },
    '70%': { transform: 'scale(1.8)', opacity: 0 },
    '100%': { transform: 'scale(1.8)', opacity: 0 },
  },
};

const IDLE_BUBBLE_SX = {
  bgcolor: 'grey.400',
  border: '1px solid rgba(0, 0, 0, 0.2)',
  borderColor: 'rgba(0, 0, 0, 0.2)',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  animation: 'none',
};







// -----------------------------------------------------------
// TipBadge
// -----------------------------------------------------------
//
// The floating "Viešas" / "Privatus" label marking which two
// blocks are the current tips of the two competing chains.
//
// Used by:
//   - BlockNode (below)
// -----------------------------------------------------------

function TipBadge({ side }) {
  const isPublic = side === 'public';

  return (
    <Box
      sx={{ position: 'absolute', top: -55, ...(isPublic ? { left: 10 } : { right: 10 }) }}
      className={`${isPublic ? 'bg-green-700' : 'bg-red-700'} rounded-full p-2 flex items-center gap-2 text-white`}
    >
      {isPublic && <BiWorld size={40} className="text-white" />}
      <Typography variant="h5" color="white">{isPublic ? 'Viešas' : 'Privatus'}</Typography>
      {!isPublic && <SiHackaday size={40} className="text-white" />}
    </Box>
  );
}







// -----------------------------------------------------------
// BlockNode (default export)
// -----------------------------------------------------------
//
// Used by:
//   - ReactFlowBlockchain.jsx — registered as nodeTypes.block
// -----------------------------------------------------------

export default function BlockNode({ data }) {

  const { block, transactions, isPublicTip, isPrivateTip, isAttacker, isWinningChain, onBlockClick } = data;

  return (
    <Box
      onClick={() => onBlockClick?.(data)}
      sx={{
        border: '2px solid rgba(0, 0, 0, 0.1)',
        borderRadius: 2,
        bgcolor: isAttacker ? 'rgba(244, 67, 54, 0.3)' : 'rgba(33, 150, 243, 0.3)',
        p: 1.5,
        minWidth: 450,
        position: 'relative',
        boxShadow: 3,
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': {
          transform: 'scale(1.02)',
          boxShadow: 6,
        },
      }}
    >
      {/* Accumulated work — glowing on the winning chain */}
      {block.chainWork !== undefined && (
        <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
          <Box
            sx={{
              position: 'relative',
              borderRadius: '12px',
              px: 1,
              py: 0.5,
              zIndex: 2,
              ...(isWinningChain ? WINNING_BUBBLE_SX : IDLE_BUBBLE_SX),
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontWeight: 'bold',
                fontSize: '0.7rem',
                color: isWinningChain ? 'white' : 'text.primary',
                textShadow: isWinningChain ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
              }}
            >
              Chain Work: {Number(block.chainWork).toFixed(6)}
            </Typography>
          </Box>
        </Box>
      )}

      {isPublicTip && <TipBadge side="public" />}
      {isPrivateTip && <TipBadge side="private" />}

      <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
        Block {block.height}
      </Typography>

      <Typography variant="body2" sx={{ mb: 1 }}>
        <b>SHA256 Hash:</b> {block.hash.slice(0, 15)} ... {block.hash.slice(49, 64)}
      </Typography>

      <Typography variant="body2" sx={{ mb: 1 }}>
        <b>Coinbase:</b> {block.coinbase.slice(0, 30)} {block.coinbase.length > 30 ? ' ...' : ''}
      </Typography>

      <Typography variant="body2" sx={{ mb: 1 }}>
        <b>Time:</b> {block.date} {block.time}
      </Typography>

      {/* One coin per tracked transaction mined into this block */}
      {transactions.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
          {transactions.map((tx) => (
            <Box
              key={tx.txid}
              sx={{
                borderRadius: '50%',
                bgcolor: tx.color,
                border: '1px solid white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 0.5,
              }}
            >
              <AttachMoneyIcon sx={{ fontSize: 16 }} />
            </Box>
          ))}
        </Box>
      )}

      {/* Target on top (from the newer block), source below
          (to the older one) — the chain grows upwards */}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </Box>
  );
}
