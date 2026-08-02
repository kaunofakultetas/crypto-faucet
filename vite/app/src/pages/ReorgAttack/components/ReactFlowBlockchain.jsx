// -----------------------------------------------------------
//  [*] ReorgAttack — ReactFlowBlockchain
//
//  The fork diagram: the two competing chains drawn as a
//  ReactFlow graph, newest blocks on top, with the attacker's
//  branch splitting off to the right. Clicking a block opens
//  its details modal.
//
//  Render-only by design — the node/edge geometry comes from
//  blockchainFlow.js and the blocks come from the page's
//  query. Nodes are fixed in place (no dragging, no
//  connecting), so ReactFlow's own node state is deliberately
//  NOT used: the memoised arrays are passed straight in and
//  there is nothing to keep in sync.
//
//  Split into (root component last):
//
//    NODE_TYPES          — ReactFlow's block → BlockNode map
//    FIT_VIEW_OPTIONS    — instant fit, no animation
//    ReactFlowBlockchain — the diagram (default export)
// -----------------------------------------------------------

import { useMemo, useState } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';

import { Box, Typography } from '@mui/material';

import BlockNode from './BlockNode';
import BlockDetailsModal from './BlockDetailsModal';
import buildBlockchainFlow from './blockchainFlow';


const NODE_TYPES = { block: BlockNode };


// Fit the whole chain on load without animating — the view
// then gets nudged to the top in onInit, because the newest
// blocks (the interesting ones) sit at the top of the diagram
const FIT_VIEW_OPTIONS = {
  padding: 0.1,
  includeHiddenNodes: false,
  minZoom: 0.6,
  maxZoom: 1.0,
  duration: 0,
};







// -----------------------------------------------------------
// ReactFlowBlockchain (default export)
// -----------------------------------------------------------
//
// Used by:
//   - Page.jsx — the page's main visualization
// -----------------------------------------------------------

export default function ReactFlowBlockchain({ chainBlocks = [], chainTips = {}, transactions = [] }) {

  const [selectedBlock, setSelectedBlock] = useState(null);

  const { nodes, edges } = useMemo(
    () => buildBlockchainFlow(chainBlocks, {
      chainTips,
      transactions,
      onBlockClick: setSelectedBlock,
    }),
    [chainBlocks, chainTips, transactions]
  );


  return (
    <Box sx={{ width: '100%', border: '1px solid #1976d2', borderRadius: 1 }}>

      <Box sx={{ height: 'calc(100vh - 215px)', bgcolor: '#f5f5f5' }}>
        {nodes.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            onInit={(instance) => {
              // fitView centres the whole chain; pull the
              // camera back to the top so the newest blocks
              // are what the student sees first
              setTimeout(() => {
                const viewport = instance.getViewport();
                instance.setViewport({ x: viewport.x, y: 50, zoom: viewport.zoom });
              }, 100);
            }}
            minZoom={0.02}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
          >
            <Background />
            <Controls />
          </ReactFlow>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="h6" color="text.secondary">
              Blokų grandinė tuščia
            </Typography>
          </Box>
        )}
      </Box>

      <BlockDetailsModal
        open={Boolean(selectedBlock)}
        onClose={() => setSelectedBlock(null)}
        blockData={selectedBlock}
        transactions={selectedBlock?.transactions ?? []}
        isAttacker={selectedBlock?.isAttacker ?? false}
      />
    </Box>
  );
}
