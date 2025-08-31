import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';
import TransactionBubble from './TransactionBubble';

const BlockComponent = ({ block, transactions, BLOCK_MIN_WIDTH, BLOCK_HEIGHT }) => {
  // Helper function to get transactions for a specific block
  const getTransactionsForBlock = (blockHash) => {
    return transactions.filter(tx => tx.blocks.includes(blockHash));
  };

  const blockTransactions = getTransactionsForBlock(block.hash);
  
  return (
    <Card
      data-block-hash={block.hash}
      sx={{
        minWidth: `${BLOCK_MIN_WIDTH}px`,
        height: `${BLOCK_HEIGHT}px`,
        backgroundColor: '#fff',
        border: '1px solid #e0e0e0',
        borderLeftWidth: '4px',
        borderLeftStyle: 'solid',
        borderLeftColor: '#e0e0e0',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <CardContent sx={{ 
        p: 1, 
        '&:last-child': { pb: 1 },
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between'
      }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {block.hash}
          </Typography>
          <Typography variant="caption" sx={{ mb: 0.2, display: 'block' }}>
            <strong>Coinbase:</strong> {block.coinbase}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            <strong>Time:</strong> {block.time}
          </Typography>
        </Box>
        {blockTransactions.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            {blockTransactions.map((tx, index) => (
              <TransactionBubble key={`${tx.txid}-${index}`} transaction={tx} />
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default BlockComponent;
