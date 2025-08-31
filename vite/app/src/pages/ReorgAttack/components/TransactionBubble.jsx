import React from 'react';
import { Box } from '@mui/material';
import { FaMoneyBillTransfer } from "react-icons/fa6";

const TransactionBubble = ({ transaction }) => (
  <Box
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      backgroundColor: transaction.color,
      margin: '2px',
      border: '1px solid rgba(0,0,0,0.1)',
      color: 'white',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
    }}
    title={`Transaction: ${transaction.txid.substring(0, 8)}...`}
  >
    <FaMoneyBillTransfer size={16} />
  </Box>
);

export default TransactionBubble;
