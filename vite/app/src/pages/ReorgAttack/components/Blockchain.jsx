import React from 'react';
import { Box, Typography } from '@mui/material';
import BlockComponent from './BlockComponent';
import LineComponent from './LineComponent';
import TipIcon from './TipIcon';

const Blockchain = ({ 
  chainBlocks, 
  chainTips, 
  transactions, 
  isPanelOpen,
  ROW_HEIGHT,
  ROW_GAP,
  LABEL_WIDTH,
  BLOCK_MIN_WIDTH,
  BLOCK_HEIGHT,
  CHAIN_COL_WIDTH,
  CENTER_COL_WIDTH,
  COL_GAP,
  LANE_HEADER_HEIGHT 
}) => {
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
  const privateTipHeight = byHash.get(chainTips.private)?.height ?? null;
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
  const privateChainIndex = findChainIndex(chainTips.private);

  // Create height-to-block mapping for each chain
  const chainHeightMaps = chains.map(chain => {
    const map = new Map();
    chain.forEach(block => map.set(block.height, block));
    return map;
  });

  return (
    <Box className="main-content-area" sx={{ position: 'relative', minHeight: `${totalHeight}px` }}>
      {/* Block connection lines - FROM current block TO previous block */}
      {chainBlocks
        .filter(block => block.prevHash) // Only blocks with previous blocks
        .map(block => (
          <LineComponent 
            key={`line-${block.hash}`}
            fromHash={block.hash}     // Start from current block
            toHash={block.prevHash}   // Point to previous block
            isPanelOpen={isPanelOpen} // Pass panel state for recalculation
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
          
          // Check if private tip is pre-fork in main chain  
          if (privateChainIndex === 0 && privateTipHeight != null && (forkHeight == null || privateTipHeight < forkHeight)) {
            preForkTips.push({ type: 'private', height: privateTipHeight });
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
        
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${ROW_GAP}px` }}>
          {heightsDesc.map((height) => {
            const beforeFork = forkHeight == null || height < forkHeight;
            const block = beforeFork ? chainHeightMaps[0]?.get(height) : null;
            return (
              <Box key={`center-${height}`} sx={{ height: `${ROW_HEIGHT}px`, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {block && (
                  <BlockComponent 
                    block={block} 
                    transactions={transactions}
                    BLOCK_MIN_WIDTH={BLOCK_MIN_WIDTH}
                    BLOCK_HEIGHT={BLOCK_HEIGHT}
                  />
                )}
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
                
                // Check if private tip is in this chain and post-fork
                if (privateChainIndex === chainIndex && privateTipHeight != null && (forkHeight == null || privateTipHeight >= forkHeight)) {
                  postForkTips.push({ type: 'private', height: privateTipHeight });
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
                      {block && (
                        <BlockComponent 
                          block={block} 
                          transactions={transactions}
                          BLOCK_MIN_WIDTH={BLOCK_MIN_WIDTH}
                          BLOCK_HEIGHT={BLOCK_HEIGHT}
                        />
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default Blockchain;
