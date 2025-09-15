import React, { useMemo } from 'react';
import ReactFlow, { Background, Controls, useNodesState, useEdgesState, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import { Box, Typography } from '@mui/material';


import { SiHackaday } from "react-icons/si";
import { BiWorld } from "react-icons/bi";

// Import the new modal component
import BlockDetailsModal from './BlockDetailsModal';




// Custom Block Node Component
const BlockNode = ({ data }) => {
  const { block, transactions, isPublicTip, isPrivateTip, isAttacker, onBlockClick, isWinningChain } = data;
  
  return (
    <Box
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
        }
      }}
      onClick={() => onBlockClick?.(data)}
    >
      {/* ChainWork bubble with pulsating animation for winning chain */}
      {block.chainWork !== undefined && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 1,
          }}
        >          
          {/* Main chainWork bubble */}
          <Box
            key={`chainwork-${block.hash}-${isWinningChain}`} // Force re-render on state change
            sx={{
              position: 'relative',
              bgcolor: isWinningChain ? 'primary.main' : 'grey.400',
              border: isWinningChain ? '2px solid' : '1px solid rgba(0, 0, 0, 0.2)',
              borderColor: isWinningChain ? 'primary.main' : 'rgba(0, 0, 0, 0.2)',
              borderRadius: '12px',
              px: 1,
              py: 0.5,
              boxShadow: isWinningChain ? '0 0 12px rgba(33, 150, 243, 0.6)' : '0 2px 4px rgba(0,0,0,0.1)',
              zIndex: 2,
              transform: 'scale(1)', // Reset transform
              // Only add animation if winning
              ...(isWinningChain ? {
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
                // Add ripple effect only for winning
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
                  '0%': {
                    transform: 'scale(1)',
                    opacity: 0.6,
                  },
                  '70%': {
                    transform: 'scale(1.8)',
                    opacity: 0,
                  },
                  '100%': {
                    transform: 'scale(1.8)',
                    opacity: 0,
                  },
                },
              } : {
                // No animations when not winning
                animation: 'none',
              }),
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

      {/* Tip indicators */}
      {isPublicTip && (
        <Box sx={{ position: 'absolute', top: -55, left: 10 }} className="bg-green-700 rounded-full p-2 flex items-center gap-2 text-white">
          <BiWorld size={40} className="text-white" />
          <Typography variant="h5" color="white">Viešas</Typography>
        </Box>
      )}
      {isPrivateTip && (
        <Box sx={{ position: 'absolute', top: -55, right: 10 }} className="bg-red-700 rounded-full p-2 flex items-center gap-2 text-white">
          <Typography variant="h5" color="white">Privatus</Typography>
          <SiHackaday size={40} className="text-white" />
        </Box>
      )}
      
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
  // Add modal state
  const [selectedBlock, setSelectedBlock] = React.useState(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  // Handle block click
  const handleBlockClick = (blockData) => {
    setSelectedBlock(blockData);
    setModalOpen(true);
  };

  // Close modal
  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedBlock(null);
  };

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




    // Simple algorithm: Find the block with highest chainWork among ALL blocks
    let winningChainHash = null;
    let bestBlockWork = -1;
    
    console.log('Finding best block by chainWork among all blocks...');
    allBlocks.forEach(block => {
      const blockChainWork = Number(block.chainWork) || 0;
      
      console.log(`Checking block ${block.hash.slice(0, 8)}: chainWork = ${blockChainWork}`);
      
      if (blockChainWork > bestBlockWork) {
        bestBlockWork = blockChainWork;
        winningChainHash = block.hash;
        console.log(`New best block: ${block.hash.slice(0, 8)} with chainWork ${blockChainWork}`);
      }
    });



    
    if (winningChainHash) {
      console.log(`Final winner: ${winningChainHash.slice(0, 8)} with chainWork ${bestBlockWork}`);
    } else {
      console.log('No winning block found');
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
            const spacing = 500;
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
            onBlockClick: handleBlockClick, // Add this line
            isWinningChain: block.hash === winningChainHash, // Pass isWinningChain
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

      {/* Add the modal */}
      <BlockDetailsModal
        open={modalOpen}
        onClose={handleCloseModal}
        blockData={selectedBlock}
        transactions={selectedBlock?.transactions || []}
        isPublicTip={selectedBlock?.isPublicTip || false}
        isPrivateTip={selectedBlock?.isPrivateTip || false}
        isAttacker={selectedBlock?.isAttacker || false}
      />
    </Box>
  );
};

export default ReactFlowBlockchain;
