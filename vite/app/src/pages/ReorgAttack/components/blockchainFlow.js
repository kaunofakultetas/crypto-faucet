// -----------------------------------------------------------
//  [*] ReorgAttack — blockchain flow builders
//
//  Pure functions turning the backend's flat block list into
//  the ReactFlow nodes and edges of the fork diagram. No
//  React, no ReactFlow imports — just data in, data out, so
//  the visual component stays render-only.
//
//  The layout tells the attack's story: newest height on top,
//  each older height one row below, and blocks that share a
//  height (a FORK) spread horizontally with the attacker's
//  blocks pushed to the right. The winning chain is simply
//  the block with the most accumulated work — the number the
//  whole teaching tool is about.
//
//  Split into (root export last):
//
//    ATTACKER_COINBASE_MARK — how an attacker block is spotted
//    LEVEL_HEIGHT / FORK_SPACING — layout geometry
//    isAttackerBlock        — coinbase test
//    groupByHeight          — height → blocks at that height
//    findWinningBlockHash   — most accumulated work wins
//    buildNodes             — the positioned block nodes
//    buildEdges             — child → parent links
//    buildBlockchainFlow    — the three combined (default)
// -----------------------------------------------------------


// The private (attacking) node stamps its coinbase — that
// mark is the only thing separating attacker blocks from
// honest ones in the payload
const ATTACKER_COINBASE_MARK = 'VU KNF';

// Vertical distance between two heights, and the horizontal
// gap between the branches of a fork (px)
const LEVEL_HEIGHT = 200;
const FORK_SPACING = 500;


export const isAttackerBlock = (block) => block.coinbase.includes(ATTACKER_COINBASE_MARK);







// -----------------------------------------------------------
// groupByHeight
// -----------------------------------------------------------
//
// height → the blocks mined at it. More than one entry means
// a fork at that height, which is what the diagram spreads
// sideways.
//
// Used by:
//   - buildNodes (below)
// -----------------------------------------------------------

export const groupByHeight = (blocks) => {
  const byHeight = new Map();

  blocks.forEach((block) => {
    const atHeight = byHeight.get(block.height) ?? [];
    atHeight.push(block);
    byHeight.set(block.height, atHeight);
  });

  return byHeight;
};







// -----------------------------------------------------------
// findWinningBlockHash
// -----------------------------------------------------------
//
// The tip of the chain with the most accumulated work — the
// consensus rule the attack exploits. Returns null for an
// empty chain.
//
// Used by:
//   - buildNodes (below) — flags the winning block
// -----------------------------------------------------------

export const findWinningBlockHash = (blocks) => {
  let winner = null;
  let bestWork = -1;

  blocks.forEach((block) => {
    const work = Number(block.chainWork) || 0;
    if (work > bestWork) {
      bestWork = work;
      winner = block.hash;
    }
  });

  return winner;
};







// -----------------------------------------------------------
// buildNodes
// -----------------------------------------------------------
//
// One positioned ReactFlow node per block. Newest height sits
// at y=0 and each older height drops one LEVEL_HEIGHT; blocks
// sharing a height are centred around x=0 with the attacker's
// on the right, so a fork reads as two visibly diverging
// branches.
//
// Used by:
//   - buildBlockchainFlow (below)
// -----------------------------------------------------------

export const buildNodes = (blocks, { chainTips, transactions, winningHash, onBlockClick }) => {
  const byHeight = groupByHeight(blocks);
  const heights = [...byHeight.keys()].sort((a, b) => b - a);
  const nodes = [];

  heights.forEach((height, levelIndex) => {
    // Attacker blocks right, honest left; hash breaks ties so
    // the arrangement stays put between refreshes
    const blocksAtHeight = [...byHeight.get(height)].sort((a, b) => {
      const aIsAttacker = isAttackerBlock(a);
      const bIsAttacker = isAttackerBlock(b);
      if (aIsAttacker !== bIsAttacker) return aIsAttacker ? 1 : -1;
      return a.hash.localeCompare(b.hash);
    });

    const totalWidth = (blocksAtHeight.length - 1) * FORK_SPACING;

    blocksAtHeight.forEach((block, index) => {
      nodes.push({
        id: block.hash,
        type: 'block',
        position: {
          x: blocksAtHeight.length > 1 ? index * FORK_SPACING - totalWidth / 2 : 0,
          y: levelIndex * LEVEL_HEIGHT,
        },
        draggable: false,
        selectable: true,
        data: {
          block,
          transactions: transactions.filter((tx) => tx.blocks?.includes(block.hash)),
          isPublicTip: block.hash === chainTips.public,
          isPrivateTip: block.hash === chainTips.private,
          isAttacker: isAttackerBlock(block),
          isWinningChain: block.hash === winningHash,
          onBlockClick,
        },
      });
    });
  });

  return nodes;
};







// -----------------------------------------------------------
// buildEdges
// -----------------------------------------------------------
//
// One edge per block that has its parent in view, drawn from
// the newer block DOWN to the older one — red along the
// attacker's branch, blue along the honest one, animated at
// the two live tips.
//
// Used by:
//   - buildBlockchainFlow (below)
// -----------------------------------------------------------

export const buildEdges = (blocks, chainTips) => {
  const knownHashes = new Set(blocks.map((block) => block.hash));

  return blocks
    .filter((block) => block.prevHash && knownHashes.has(block.prevHash))
    .map((block) => ({
      id: `${block.hash}-to-${block.prevHash}`,
      source: block.hash,
      target: block.prevHash,
      sourceHandle: 'bottom',
      targetHandle: 'top',
      style: {
        stroke: isAttackerBlock(block) ? '#f44336' : '#2196f3',
        strokeWidth: 3,
      },
      animated: block.hash === chainTips.public || block.hash === chainTips.private,
    }));
};







// -----------------------------------------------------------
// buildBlockchainFlow (default export)
// -----------------------------------------------------------
//
//   const { nodes, edges } =
//     buildBlockchainFlow(chainBlocks, {
//       chainTips, transactions, onBlockClick })
//
// Used by:
//   - ReactFlowBlockchain.jsx — inside one useMemo
// -----------------------------------------------------------

export default function buildBlockchainFlow(chainBlocks, { chainTips, transactions, onBlockClick }) {
  if (!chainBlocks.length) {
    return { nodes: [], edges: [] };
  }

  // Copy before sorting — chainBlocks belongs to the query
  // cache, and sorting it in place would reorder the data
  // other consumers see
  const blocks = [...chainBlocks].sort((a, b) => b.height - a.height);

  return {
    nodes: buildNodes(blocks, {
      chainTips,
      transactions,
      winningHash: findWinningBlockHash(blocks),
      onBlockClick,
    }),
    edges: buildEdges(blocks, chainTips),
  };
}
