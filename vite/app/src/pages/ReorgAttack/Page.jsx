import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

import { SiHackaday } from "react-icons/si";
import { BiWorld } from "react-icons/bi";

export default function ReorgAttackPage() {
  // Layout constants for consistent spacing and alignment
  const ROW_HEIGHT = 120; // px height per block row
  const ROW_GAP = 50; // px gap between rows
  const LABEL_WIDTH = 72; // px reserved for left height labels
  const BLOCK_MIN_WIDTH = 200; // px card min width
  const CHAIN_COL_WIDTH = 240; // px width per chain lane
  const CENTER_COL_WIDTH = CHAIN_COL_WIDTH; // center lane width for pre-fork overlay
  const COL_GAP = 10; // gap between chain lanes
  const LANE_HEADER_HEIGHT = 0; // no top labels/headers

  // Data structure (integrated)
  const chainBlocks = [
    { height: 1, hash: '000a1b2c', prevHash: null, coinbase: 'Binance', timestamp: '2024-01-01 10:00:00' },
    { height: 2, hash: '000b2c3d', prevHash: '000a1b2c', coinbase: 'Slush Pool', timestamp: '2024-01-01 10:10:00' },
    { height: 3, hash: '000c3d4e', prevHash: '000b2c3d', coinbase: 'F2Pool', timestamp: '2024-01-01 10:20:00' },
    { height: 4, hash: '000d4e5f', prevHash: '000c3d4e', coinbase: 'AntPool', timestamp: '2024-01-01 10:30:00' },
    { height: 5, hash: '000e5f6g', prevHash: '000d4e5f', coinbase: 'BTC.com', timestamp: '2024-01-01 10:40:00' },
    { height: 6, hash: '000f6g7h', prevHash: '000e5f6g', coinbase: 'ViaBTC', timestamp: '2024-01-01 10:50:00' },
    { height: 7, hash: '000g7h8i', prevHash: '000f6g7h', coinbase: 'Poolin', timestamp: '2024-01-01 11:00:00' },

    { height: 5, hash: '111e5f6g', prevHash: '000d4e5f', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 10:41:00' },
    { height: 6, hash: '111f6g7h', prevHash: '111e5f6g', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 10:51:00' },
    { height: 7, hash: '111g7h8i', prevHash: '111f6g7h', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 11:01:00' },
    { height: 8, hash: '111h8i9j', prevHash: '111g7h8i', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 11:11:00' },
    { height: 9, hash: '111i9j0k', prevHash: '111h8i9j', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 11:21:00' },
    { height: 10, hash: '111j0k1l', prevHash: '111i9j0k', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 11:31:00' },
    { height: 11, hash: '111k1l2m', prevHash: '111j0k1l', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 11:41:00' },
    { height: 12, hash: '111l2m3n', prevHash: '111k1l2m', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 11:51:00' },
    { height: 13, hash: '111m3n4o', prevHash: '111l2m3n', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 12:01:00' },
    { height: 14, hash: '111n4o5p', prevHash: '111m3n4o', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 12:11:00' },
    { height: 15, hash: '111o5p6q', prevHash: '111n4o5p', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 12:21:00' },
    { height: 16, hash: '111p6q7r', prevHash: '111o5p6q', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 12:31:00' },
    { height: 17, hash: '111q7r8s', prevHash: '111p6q7r', coinbase: 'VU KNF Attacker', timestamp: '2024-01-01 12:41:00' },

  ];

  const chainTips = {
    public: '111q7r8s',
    attacker: '111q7r8s',
  };

  // Build lookup and FIXED chain detection
  const byHash = React.useMemo(() => new Map(chainBlocks.map(b => [b.hash, b])), [chainBlocks]);

  // Fixed: properly detect distinct chains by finding leaf nodes
  const { chains, forkHeight, allHeights, heightsDesc } = React.useMemo(() => {
    // Find leaf nodes (blocks that no other block references)
    const referencedHashes = new Set(chainBlocks.map(b => b.prevHash).filter(Boolean));
    const leafBlocks = chainBlocks.filter(block => !referencedHashes.has(block.hash));
    
    // Build complete chains by tracing back from each leaf
    const chains = leafBlocks.map(leafBlock => {
      const chain = [];
      let current = leafBlock;
      while (current) {
        chain.unshift(current);
        current = current.prevHash ? byHash.get(current.prevHash) : null;
      }
      return chain;
    }).sort((a, b) => {
      // Sort: main chain first, then by tip height descending
      const aIsMain = a.every(block => block.coinbase !== 'VU KNF Attacker');
      const bIsMain = b.every(block => block.coinbase !== 'VU KNF Attacker');
      if (aIsMain !== bIsMain) return aIsMain ? -1 : 1;
      
      const aTipHeight = a[a.length - 1].height;
      const bTipHeight = b[b.length - 1].height;
      return bTipHeight - aTipHeight;
    });

    // Find fork height (first height where multiple chains diverge)
    const allHeights = [...new Set(chainBlocks.map(b => b.height))].sort((a, b) => a - b);
    let forkHeight = null;
    
    for (const height of allHeights) {
      const blocksAtHeight = chainBlocks.filter(b => b.height === height);
      if (blocksAtHeight.length > 1) {
        forkHeight = height;
        break;
      }
    }

    const heightsDesc = allHeights.slice().reverse();
    return { chains, forkHeight, allHeights, heightsDesc };
  }, [chainBlocks, byHash]);

  const totalHeight = LANE_HEADER_HEIGHT + heightsDesc.length * ROW_HEIGHT + Math.max(0, heightsDesc.length - 1) * ROW_GAP;

  // Tip helpers
  const publicTipHeight = byHash.get(chainTips.public)?.height ?? null;
  const attackerTipHeight = byHash.get(chainTips.attacker)?.height ?? null;
  const rowSepTopWithin = (idx) => idx * (ROW_HEIGHT + ROW_GAP) - ROW_GAP / 2;
  const bubbleTopForHeight = (h) => {
    if (h == null) return null;
    const idx = heightsDesc.indexOf(h);
    if (idx === -1) return null;
    return rowSepTopWithin(idx);
  };

  // Find which chain contains each tip
  const findChainIndex = (tipHash) => {
    return chains.findIndex(chain => chain.some(block => block.hash === tipHash));
  };

  const publicChainIndex = findChainIndex(chainTips.public);
  const attackerChainIndex = findChainIndex(chainTips.attacker);

  // Create height-to-block mapping for each chain
  const chainHeightMaps = chains.map(chain => {
    const map = new Map();
    chain.forEach(block => map.set(block.height, block));
    return map;
  });

  // Count post-fork chains for layout
  const postForkChains = chains.filter((chain, index) => 
    forkHeight !== null && chain.some(block => block.height >= forkHeight)
  );

  const BlockComponent = ({ block }) => (
    <Card
      data-block-hash={block.hash}
      sx={{
        minWidth: `${BLOCK_MIN_WIDTH}px`,
        backgroundColor: '#fff',
        border: '1px solid #e0e0e0',
        borderLeftWidth: '4px',
        borderLeftStyle: 'solid',
        borderLeftColor: '#e0e0e0',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }
      }}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {block.coinbase}
        </Typography>
        <Typography variant="caption" sx={{ mb: 0.5, display: 'block' }}>
          <strong>Hash:</strong> {block.hash}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          <strong>Time:</strong> {block.timestamp.split(' ')[1]}
        </Typography>
      </CardContent>
    </Card>
  );

  const TipIcon = ({ type, position, top }) => {
    const isPublic = type === 'public';
    return (
      <Box sx={{ 
        position: 'absolute', 
        top: `${top}px`, 
        left: position, 
        transform: 'translate(-50%, -50%)', 
        width: 28, 
        height: 28, 
        borderRadius: '9999px', 
        backgroundColor: isPublic ? '#2e7d32' : '#c62828', 
        color: '#fff', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        boxShadow: '0 0 0 2px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.2)', 
        zIndex: 4, 
        pointerEvents: 'none' 
      }}>
        {isPublic ? <BiWorld size={16} /> : <SiHackaday size={16} />}
      </Box>
    );
  };

  // Helper to find which lane/chain contains a block
  const findBlockPosition = (blockHash) => {
    const block = byHash.get(blockHash);
    if (!block) return null;
    
    const rowIndex = heightsDesc.indexOf(block.height);
    const y = LANE_HEADER_HEIGHT + rowIndex * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;
    
    // Check if block is pre-fork (in center)
    if (forkHeight == null || block.height < forkHeight) {
      // Use a simpler approach: just get the actual center
      // The pre-fork overlay is positioned at 50% with translateX(-50%) + margin
      // So its center is at 50% of viewport + half the margin
      const x = window.innerWidth * 0.5 + (LABEL_WIDTH + 8) / 2;
      return { x, y, lane: 'center' };
    }
    
    // Find which post-fork chain contains this block
    const postForkChains = chains.filter(chain => 
      forkHeight !== null && chain.some(b => b.height >= forkHeight)
    );
    
    const postForkIndex = postForkChains.findIndex(chain => 
      chain.some(b => b.hash === blockHash)
    );
    
    if (postForkIndex === -1) return null;
    
    // For post-fork, calculate based on CSS flexbox centering
    // The container has pl: LABEL_WIDTH + 8, then justifyContent: center
    const leftPadding = LABEL_WIDTH + 8;
    const availableWidth = window.innerWidth - leftPadding;
    const totalWidth = postForkChains.length * CHAIN_COL_WIDTH + (postForkChains.length - 1) * COL_GAP;
    const startX = leftPadding + (availableWidth - totalWidth) / 2;
    const x = startX + postForkIndex * (CHAIN_COL_WIDTH + COL_GAP) + CHAIN_COL_WIDTH / 2;
    
    return { x, y, lane: 'postfork', postForkIndex };
  };

  const LineComponent = ({ fromHash, toHash }) => {
    // Use React ref to get actual DOM positions
    const [positions, setPositions] = React.useState(null);
    
    React.useEffect(() => {
      const updatePositions = () => {
        const fromElement = document.querySelector(`[data-block-hash="${fromHash}"]`);
        const toElement = document.querySelector(`[data-block-hash="${toHash}"]`);
        
        if (fromElement && toElement) {
          const fromRect = fromElement.getBoundingClientRect();
          const toRect = toElement.getBoundingClientRect();
          const containerRect = document.querySelector('.main-content-area').getBoundingClientRect();
          
          setPositions({
            startX: fromRect.left + fromRect.width / 2 - containerRect.left,
            startY: fromRect.bottom - containerRect.top,
            endX: toRect.left + toRect.width / 2 - containerRect.left,
            endY: toRect.top - containerRect.top
          });
        }
      };
      
      // Update positions after render
      setTimeout(updatePositions, 100);
      window.addEventListener('resize', updatePositions);
      
      return () => window.removeEventListener('resize', updatePositions);
    }, [fromHash, toHash]);
    
    if (!positions) return null;
    
    const { startX, startY, endX, endY } = positions;
    
    // Calculate control point for smooth curve
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const controlX = startX + deltaX / 2;
    const controlY = startY + deltaY / 3;
    
    return (
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1
        }}
      >
        <path
          d={`M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`}
          stroke="#4a90e2"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    );
  };

  return (
    <Box sx={{ p: 2, position: 'relative' }}>
      {/* Title */}
      <Box sx={{ position: 'relative', mb: 10 }}>
        <Typography variant="h5" sx={{ textAlign: 'center', fontWeight: 'bold' }}>
          51% Attack Blockchain Visualization
        </Typography>
      </Box>

      {/* Main content area */}
      <Box className="main-content-area" sx={{ position: 'relative', minHeight: `${totalHeight}px` }}>
        {/* Block connection lines - FROM current block TO previous block */}
        {chainBlocks
          .filter(block => block.prevHash) // Only blocks with previous blocks
          .map(block => (
            <LineComponent 
              key={`line-${block.hash}`}
              fromHash={block.hash}     // Start from current block
              toHash={block.prevHash}   // Point to previous block
            />
          ))}
        {/* Block height numbers at far left */}
        <Box sx={{ position: 'absolute', left: 0, top: `${LANE_HEADER_HEIGHT}px`, zIndex: 3, width: `${LABEL_WIDTH}px`, display: 'flex', flexDirection: 'column', gap: `${ROW_GAP}px` }}>
          {heightsDesc.map((height) => (
            <Box key={height} sx={{ height: `${ROW_HEIGHT}px`, display: 'flex', alignItems: 'center' }}>
              <Typography variant="h4" sx={{ lineHeight: 1, fontWeight: 800, color: '#9e9e9e' }}>
                {height}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Dotted separators between rows */}
        <Box sx={{ position: 'absolute', top: `${LANE_HEADER_HEIGHT - ROW_GAP / 2}px`, left: 0, right: 0, height: '1px', borderTop: '1px dashed rgba(0,0,0,0.12)', zIndex: 1 }} />
        {heightsDesc.slice(1).map((_, idx) => (
          <Box key={`sep-${idx}`} sx={{ position: 'absolute', top: `${LANE_HEADER_HEIGHT + (idx + 1) * (ROW_HEIGHT + ROW_GAP) - ROW_GAP / 2}px`, left: 0, right: 0, height: '1px', borderTop: '1px dashed rgba(0,0,0,0.12)', zIndex: 1 }} />
        ))}

        {/* Pre-fork center overlay - aligned with post-fork lanes */}
        <Box sx={{ 
          position: 'absolute', 
          top: 0, 
          left: '50%', 
          transform: 'translateX(-50%)', 
          width: `${CENTER_COL_WIDTH}px`, 
          zIndex: 2,
          ml: `${(LABEL_WIDTH + 8) / 2}px` // Half of post-fork padding to center align
        }}>
          {/* FIXED: Pre-fork tip icons with collision detection */}
          {(() => {
            const preForkTips = [];
            
            // Check if public tip is pre-fork in main chain
            if (publicChainIndex === 0 && publicTipHeight != null && (forkHeight == null || publicTipHeight < forkHeight)) {
              preForkTips.push({ type: 'public', height: publicTipHeight });
            }
            
            // Check if attacker tip is pre-fork in main chain  
            if (attackerChainIndex === 0 && attackerTipHeight != null && (forkHeight == null || attackerTipHeight < forkHeight)) {
              preForkTips.push({ type: 'attacker', height: attackerTipHeight });
            }

            // Group by height and position accordingly
            const tipsByHeight = new Map();
            preForkTips.forEach(tip => {
              const height = tip.height;
              if (!tipsByHeight.has(height)) tipsByHeight.set(height, []);
              tipsByHeight.get(height).push(tip);
            });

            return Array.from(tipsByHeight.entries()).map(([height, tips]) => {
              if (tips.length === 1) {
                return (
                  <TipIcon 
                    key={`prefork-${height}-${tips[0].type}`}
                    type={tips[0].type} 
                    position="50%" 
                    top={bubbleTopForHeight(height) ?? 0} 
                  />
                );
              } else {
                // Multiple tips at same height - position side by side
                return tips.map((tip, idx) => (
                  <TipIcon 
                    key={`prefork-${height}-${tip.type}`}
                    type={tip.type} 
                    position={`${40 + idx * 20}%`} // 40%, 60% for 2 tips
                    top={bubbleTopForHeight(height) ?? 0} 
                  />
                ));
              }
            }).flat();
          })()}
          
          {/* Fork connectors */}
          {forkHeight !== null && (
            <>
              <Box sx={{ position: 'absolute', top: `${heightsDesc.indexOf(forkHeight) * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2 - 1}px`, left: 'calc(50% - 1px)', width: '48px', height: '2px', backgroundColor: '#ffb74d', transform: 'translateX(-100%)' }} />
              <Box sx={{ position: 'absolute', top: `${heightsDesc.indexOf(forkHeight) * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2 - 1}px`, left: 'calc(50% - 1px)', width: '48px', height: '2px', backgroundColor: '#ffb74d' }} />
            </>
          )}
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${ROW_GAP}px` }}>
            {heightsDesc.map((height) => {
              const beforeFork = forkHeight == null || height < forkHeight;
              const block = beforeFork ? chainHeightMaps[0]?.get(height) : null;
              return (
                <Box key={`center-${height}`} sx={{ height: `${ROW_HEIGHT}px`, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {block && <BlockComponent block={block} />}
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Post-fork lanes for each chain - naturally centered */}
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'center', 
          gap: `${COL_GAP}px`, 
          position: 'relative', 
          zIndex: 1, 
          width: '100%', 
          pl: `${LABEL_WIDTH + 8}px`
        }}>
          {chains.map((chain, chainIndex) => {
            const hasPostForkBlocks = forkHeight !== null && chain.some(block => block.height >= forkHeight);
            if (!hasPostForkBlocks) return null;

            return (
              <Box key={`chain-${chainIndex}`} sx={{ width: `${CHAIN_COL_WIDTH}px`, position: 'relative' }}>
                {/* FIXED: Tip icons with collision detection */}
                {(() => {
                  const postForkTips = [];
                  
                  // Check if public tip is in this chain and post-fork
                  if (publicChainIndex === chainIndex && publicTipHeight != null && (forkHeight == null || publicTipHeight >= forkHeight)) {
                    postForkTips.push({ type: 'public', height: publicTipHeight });
                  }
                  
                  // Check if attacker tip is in this chain and post-fork
                  if (attackerChainIndex === chainIndex && attackerTipHeight != null && (forkHeight == null || attackerTipHeight >= forkHeight)) {
                    postForkTips.push({ type: 'attacker', height: attackerTipHeight });
                  }

                  // Group by height and position accordingly
                  const tipsByHeight = new Map();
                  postForkTips.forEach(tip => {
                    const height = tip.height;
                    if (!tipsByHeight.has(height)) tipsByHeight.set(height, []);
                    tipsByHeight.get(height).push(tip);
                  });

                  return Array.from(tipsByHeight.entries()).map(([height, tips]) => {
                    if (tips.length === 1) {
                      return (
                        <TipIcon 
                          key={`chain-${chainIndex}-${height}-${tips[0].type}`}
                          type={tips[0].type} 
                          position="50%" 
                          top={bubbleTopForHeight(height) ?? 0} 
                        />
                      );
                    } else {
                      // Multiple tips at same height - position side by side
                      return tips.map((tip, idx) => (
                        <TipIcon 
                          key={`chain-${chainIndex}-${height}-${tip.type}`}
                          type={tip.type} 
                          position={`${40 + idx * 20}%`} // 40%, 60% for 2 tips
                          top={bubbleTopForHeight(height) ?? 0} 
                        />
                      ));
                    }
                  }).flat();
                })()}

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${ROW_GAP}px` }}>
                  {heightsDesc.map((height) => {
                    const isPostFork = forkHeight != null && height >= forkHeight;
                    const block = isPostFork ? chainHeightMaps[chainIndex]?.get(height) : null;
                    return (
                      <Box key={`chain-${chainIndex}-${height}`} sx={{ height: `${ROW_HEIGHT}px`, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {block && <BlockComponent block={block} />}
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

    </Box>
  );
}