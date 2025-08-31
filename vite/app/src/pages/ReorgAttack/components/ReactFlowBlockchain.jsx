import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Box, Typography, Chip } from '@mui/material';



// Custom Block Node Component
const BlockNode = ({ data }) => {
  const { block, transactions, isPublicTip, isPrivateTip, isAttacker } = data;
  
  return (
    <Box
      sx={{
        border: isAttacker ? '5px solid #f44336' : '5px solid #2196f3',
        borderRadius: 2,
        bgcolor: 'background.paper',
        p: 1.5,
        minWidth: 300,
        position: 'relative',
        boxShadow: 3,
        cursor: 'default', // Change cursor to indicate non-draggable
      }}
    >
      {/* Tip indicators */}
      {isPublicTip && (
        <Chip 
          label="Public Tip" 
          size="small" 
          color="primary" 
          sx={{ position: 'absolute', top: -12, left: 8, fontSize: '10px' }}
        />
      )}
      {isPrivateTip && (
        <Chip 
          label="Private Tip" 
          size="small" 
          color="secondary" 
          sx={{ position: 'absolute', top: -12, right: 8, fontSize: '10px' }}
        />
      )}
      
      <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
        Block {block.height}
      </Typography>
      
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {block.hash.slice(0, 20)} {block.hash.length > 20 ? ' ...' : ''}
      </Typography>
      
      <Typography variant="body2" sx={{ mb: 1, fontSize: '0.8rem' }}>
        {block.coinbase.slice(0, 20)} {block.coinbase.length > 20 ? ' ...' : ''}
      </Typography>
      
      <Typography variant="caption" color="text.secondary">
        {block.time}
      </Typography>
      
      {/* Transaction indicators */}
      {transactions && transactions.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
          {transactions.map((tx, idx) => (
            <Box
              key={idx}
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: tx.color,
                border: '1px solid white'
              }}
            />
          ))}
        </Box>
      )}
      
      {/* Connection handles - top for receiving connections from newer blocks, bottom for connecting to older blocks */}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </Box>
  );
};


const nodeTypes = {
  block: BlockNode,
};



const ReactFlowBlockchain = ({ chainBlocks = [], chainTips = {}, transactions = [] }) => {

  // Process blockchain data
  const { nodes, edges, maxHeight, minHeight } = useMemo(() => {
    if (!chainBlocks || chainBlocks.length === 0) {
      return { nodes: [], edges: [], maxHeight: 0, minHeight: 0 };
    }


    // Get height range
    const heights = chainBlocks.map(b => b.height);
    const minHeight = Math.min(...heights);
    const maxHeight = Math.max(...heights);
    
    
    // Use ALL blocks instead of limiting to recent ones
    const allBlocks = chainBlocks.sort((a, b) => b.height - a.height); // Sort by height descending
    
    
    // Group blocks by height for fork detection
    const blocksByHeight = {};
    allBlocks.forEach(block => {
      if (!blocksByHeight[block.height]) blocksByHeight[block.height] = [];
      blocksByHeight[block.height].push(block);
    });
    
    
    // Find current tip heights to determine chain competition
    const currentTipHeights = [];
    if (chainTips.public) {
      const publicTipBlock = allBlocks.find(b => b.hash === chainTips.public);
      if (publicTipBlock) currentTipHeights.push(publicTipBlock.height);
    }
    if (chainTips.private) {
      const privateTipBlock = allBlocks.find(b => b.hash === chainTips.private);
      if (privateTipBlock) currentTipHeights.push(privateTipBlock.height);
    }

    // Calculate height difference between competing chains
    const heightDifference = currentTipHeights.length === 2 ? 
      Math.abs(currentTipHeights[0] - currentTipHeights[1]) : 0;

    // Find which chain has the higher tip (winning chain)
    const maxTipHeight = Math.max(...currentTipHeights);
    const winningChainHash = currentTipHeights.length === 2 ? 
      (allBlocks.find(b => b.height === maxTipHeight && (b.hash === chainTips.public || b.hash === chainTips.private))?.hash) : null;



    const sortedHeights = Object.keys(blocksByHeight).map(h => parseInt(h)).sort((a, b) => a - b);
    for (const height of sortedHeights) {
        const blocksAtHeight = blocksByHeight[height];
    }


 
    const heightPositions = {}; // height -> { blockHash: xPosition }
    const nodes = [];
    const edges = [];
    

    // Create nodes - recent blocks at top (y=0), older blocks below
    Object.keys(blocksByHeight)
      .sort((a, b) => parseInt(b) - parseInt(a)) // Sort descending (recent first)
      .forEach((heightStr, levelIndex) => {
        const height = parseInt(heightStr);
        const blocksAtHeight = blocksByHeight[height];

        // Initialize position storage for this height
        heightPositions[height] = heightPositions[height] || {};


        // CONSISTENT ORDERING: Sort blocks at same height for consistent positioning
        const sortedBlocks = blocksAtHeight.sort((a, b) => {
          // Primary sort: Attacker blocks (VU KNF) go to the RIGHT, honest blocks to the LEFT
          const aIsAttacker = a.coinbase.includes('VU KNF');
          const bIsAttacker = b.coinbase.includes('VU KNF');
          
          if (aIsAttacker !== bIsAttacker) {
            return aIsAttacker ? 1 : -1; // Attacker blocks go right (higher index)
          }
          
          // Secondary sort: By hash for consistency when same type
          return a.hash.localeCompare(b.hash);
        });
        
        sortedBlocks.forEach((block, index) => {
          // CORRECTED DYNAMIC POSITIONING LOGIC
          const isFork = sortedBlocks.length > 1;
          let x = 0;
          
          if (isFork) {
            // Rule: 1-9 blocks difference - Keep forks on separate sides
              const spacing = 450;
              const totalWidth = (sortedBlocks.length - 1) * spacing;
              x = (index * spacing) - (totalWidth / 2);
          }

          // Store this block's position for its children
          heightPositions[height][block.hash] = x;
          
          // Recent blocks at top (y=0), older blocks below
          const y = levelIndex * 200;
          
          // Detect attacker blocks
          const isAttacker = block.coinbase.includes('VU KNF');
          
          // Find transactions for this block
          const blockTransactions = transactions.filter(tx => 
            block.transactions && block.transactions.includes(tx.txid)
          ) || [];
          
          nodes.push({
            id: block.hash,
            type: 'block',
            position: { x, y },
            draggable: false, // Make blocks non-draggable
            selectable: true, // Still allow selection for potential future features
            data: {
              block,
              transactions: blockTransactions,
              isPublicTip: block.hash === chainTips.public,
              isPrivateTip: block.hash === chainTips.private,
              isAttacker,
            },
          });
        });
      });

    
    // Create edges AFTER all nodes are created
    allBlocks.forEach(block => {
      if (block.prevHash) {
        const prevBlock = allBlocks.find(b => b.hash === block.prevHash);
        if (prevBlock) {
          // Edge goes FROM current block TO previous block (newer to older)
          // This creates connections from bottom of newer block to top of older block
          const isAttacker = block.coinbase.includes('VU KNF');
          edges.push({
            id: `${block.hash}-to-${block.prevHash}`,
            source: block.hash,          // Current (newer) block
            target: block.prevHash,      // Previous (older) block
            sourceHandle: 'bottom',      // Connect from bottom of newer block
            targetHandle: 'top',         // Connect to top of older block
            style: {
              stroke: isAttacker ? '#f44336' : '#2196f3',
              strokeWidth: 3,
            },
            animated: block.hash === chainTips.public || block.hash === chainTips.private,
          });
        }
      }
    });


    return { nodes, edges, maxHeight, minHeight };
  }, [chainBlocks, chainTips, transactions]);


  const [flowNodes, setNodes, onNodesChange] = useNodesState(nodes);
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState(edges);

  // Update when data changes
  React.useEffect(() => {
    setNodes(nodes);
    setEdges(edges);
  }, [nodes, edges, setNodes, setEdges]);

  // Count different types of blocks
  const stats = useMemo(() => {
    const attackerBlocks = chainBlocks.filter(b => b.coinbase.includes('VU KNF')).length;
    const honestBlocks = chainBlocks.length - attackerBlocks;
    const forkCount = Object.values(
      chainBlocks.reduce((acc, block) => {
        acc[block.height] = (acc[block.height] || 0) + 1;
        return acc;
      }, {})
    ).filter(count => count > 1).length;
    
    return { attackerBlocks, honestBlocks, forkCount };
  }, [chainBlocks]);

  return (
    <Box sx={{ width: '100%', border: '1px solid #1976d2', borderRadius: 1 }}>
      
      <Box sx={{ height: 'calc(100vh - 205px)', bgcolor: '#f5f5f5' }}>
        {flowNodes.length > 0 ? (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView={true}  // Use fitView but with custom options
            fitViewOptions={{
              padding: 0.1,
              includeHiddenNodes: false,
              minZoom: 0.6,
              maxZoom: 1.0,
              duration: 0, // No animation, instant fit
            }}
            onInit={(instance) => {
              // After initial fit, adjust to show top
              setTimeout(() => {
                const viewport = instance.getViewport();
                instance.setViewport({
                  x: viewport.x, // Keep horizontal centering from fitView
                  y: 50,         // Override to show top
                  zoom: viewport.zoom // Keep the zoom level from fitView
                });
              }, 100);
            }}
            minZoom={0.02}
            maxZoom={2}
            nodesDraggable={false} // Disable dragging for all nodes globally
            nodesConnectable={false} // Disable connecting nodes
            elementsSelectable={true} // Still allow selection
          >
            <Background />
            <Controls />
          </ReactFlow>
        ) : (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%' 
          }}>
            <Typography variant="h6" color="text.secondary">
              Loading blockchain data...
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ReactFlowBlockchain;
