import React from 'react';
import { Box, Typography, CircularProgress, Alert, Snackbar } from '@mui/material';

// Import extracted components
import ControlPanel from './components/ControlPanel';
import ToggleButton from './components/ToggleButton';
import ReactFlowBlockchain from './components/ReactFlowBlockchain';





export default function ReorgAttackPage() {

  // Predefined colors for transaction tracking
  const TRANSACTION_COLORS = ['red', 'green', 'blue', 'orange', 'purple', 'pink', 'cyan', 'yellow'];

  // Panel width for layout calculations
  const PANEL_WIDTH = 350;

  // State management
  const [isPanelOpen, setIsPanelOpen] = React.useState(false);
  const [isConnectedToPublic, setIsConnectedToPublic] = React.useState(true);
  const [rawTransaction, setRawTransaction] = React.useState('');
  const [rawTxColor, setRawTxColor] = React.useState('red');
  const [transactions, setTransactions] = React.useState([]);
  const [newTxid, setNewTxid] = React.useState('');
  const [selectedColor, setSelectedColor] = React.useState('green');

  // Data state
  const [chainBlocks, setChainBlocks] = React.useState([]);
  const [chainTips, setChainTips] = React.useState({ public: null, private: null });
  const [networkStatus, setNetworkStatus] = React.useState({});
  
  // Loading and error states
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [snackbarOpen, setSnackbarOpen] = React.useState(false);
  const [snackbarMessage, setSnackbarMessage] = React.useState('');
  const [snackbarSeverity, setSnackbarSeverity] = React.useState('info');

  // API base URL
  const API_BASE = '/api/reorgattack';


  // Show snackbar message
  const showMessage = (message, severity = 'info') => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  };


  // Fetch blockchain data from backend
  const fetchBlockchainData = async () => {
    try {
      const response = await fetch(`${API_BASE}/blockchain/data`);
      const result = await response.json();
      
      if (result.success) {
        setChainBlocks(result.data.chainBlocks || []);
        setChainTips(result.data.chainTips || { public: null, private: null });
        setTransactions(result.data.transactions || []);
      } else {
        throw new Error(result.message || 'Failed to fetch blockchain data');
      }
    } catch (err) {
      console.error('Error fetching blockchain data:', err);
      setError(err.message);
      showMessage('Failed to load blockchain data', 'error');
    }
  };


  // Fetch network status
  const fetchNetworkStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/status`);
      const result = await response.json();
      
      if (result.success) {
        setNetworkStatus(result.status || {});
        setIsConnectedToPublic(result.status?.isConnectedToPublic || false);
      } else {
        console.warn('Failed to fetch network status:', result.message);
      }
    } catch (err) {
      console.error('Error fetching network status:', err);
    }
  };


  // Initial data load
  React.useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
        await Promise.all([
          fetchBlockchainData(),
          fetchNetworkStatus()
        ]);
      } catch (err) {
        console.error('Error loading initial data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);



  // Auto-refresh data every 10 seconds to stay in sync with background updates
  React.useEffect(() => {
    const interval = setInterval(() => {
      fetchBlockchainData();
      fetchNetworkStatus();
    }, 10000); // 10 second refresh

    return () => clearInterval(interval);
  }, []);





  // Handle connection toggle
  const handleConnectionToggle = async (connected) => {
    try {
      const endpoint = connected ? `${API_BASE}/connect` : `${API_BASE}/disconnect`;
      const response = await fetch(endpoint);
      const result = await response.json();
      
      if (result.success) {
        setIsConnectedToPublic(connected);
        showMessage(
          connected ? 'Prisijungta prie viešo tinklo' : 'Atjungta nuo viešo tinklo',
          'success'
        );
        // Refresh network status after connection change
        setTimeout(fetchNetworkStatus, 1000);
      } else {
        throw new Error(result.message || 'Prisijungimo operacija nepavyko');
      }
    } catch (err) {
      console.error('Error toggling connection:', err);
      showMessage(`Nepavyko ${connected ? 'prisijungti' : 'atjungti'}: ${err.message}`, 'error');
      // Revert the toggle if it failed
      setIsConnectedToPublic(!connected);
    }
  };




  // Handle raw transaction send
  const handleSendRawTransaction = async () => {
    if (!rawTransaction.trim()) return;
    
    try {
      const response = await fetch(`${API_BASE}/transactions/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw_transaction: rawTransaction.trim(),
          color: rawTxColor
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        showMessage(`Transakcija sėkmingai išsiųsta! TXID: ${result.txid}`, 'success');
        setRawTransaction('');
        // Refresh data to show any new blocks
        setTimeout(fetchBlockchainData, 2000);
      } else {
        throw new Error(result.message || 'Nepavyko išsiųsti transakcijos');
      }
    } catch (err) {
      console.error('Error sending transaction:', err);
      showMessage(`Nepavyko išsiųsti transakcijos: ${err.message}`, 'error');
    }
  };




  // Handle add transaction tracking
  const handleAddTransaction = async () => {
    if (!newTxid.trim()) return;
    
    try {
      const response = await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          txid: newTxid.trim(),
          color: selectedColor
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        showMessage('Transaction tracking added successfully', 'success');
        setNewTxid('');
        // Refresh data to show updated transactions
        fetchBlockchainData();
      } else {
        throw new Error(result.message || 'Failed to add transaction tracking');
      }
    } catch (err) {
      console.error('Error adding transaction tracking:', err);
      showMessage(`Failed to add transaction tracking: ${err.message}`, 'error');
    }
  };




  // Handle remove transaction tracking
  const handleRemoveTransaction = async (txid) => {
    try {
      const response = await fetch(`${API_BASE}/transactions/${txid}`, {
        method: 'DELETE',
      });
      
      const result = await response.json();
      
      if (result.success) {
        showMessage('Transaction tracking removed', 'success');
        // Refresh data to show updated transactions
        fetchBlockchainData();
      } else {
        throw new Error(result.message || 'Failed to remove transaction tracking');
      }
    } catch (err) {
      console.error('Error removing transaction tracking:', err);
      showMessage(`Failed to remove transaction tracking: ${err.message}`, 'error');
    }
  };



  



  // Show loading spinner while data loads
  if (loading) {
    return (
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '50vh',
        flexDirection: 'column',
        gap: 2
      }}>
        <CircularProgress size={60} />
        <Typography variant="h6" color="text.secondary">
          Loading blockchain data...
        </Typography>
      </Box>
    );
  }


  // Show error if data loading failed
  if (error && chainBlocks.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load blockchain data: {error}
        </Alert>
        <Typography variant="body1">
          Please check your connection and try refreshing the page.
        </Typography>
      </Box>
    );
  }
    


  return (
    <Box sx={{ 
      p: 2, 
      position: 'relative',
      paddingRight: isPanelOpen ? `${PANEL_WIDTH + 20}px` : 2,
      transition: 'padding-right 0.3s ease-in-out'
    }}
    onTransitionEnd={() => {
      // Force line recalculation after layout transition completes
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 50);
    }}>
      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={6000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbarOpen(false)} 
          severity={snackbarSeverity}
          sx={{ width: '100%' }}
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>

      {/* Control Panel */}
      <ControlPanel 
        isPanelOpen={isPanelOpen}
        setIsPanelOpen={setIsPanelOpen}
        isConnectedToPublic={isConnectedToPublic}
        onConnectionToggle={handleConnectionToggle}
        rawTransaction={rawTransaction}
        setRawTransaction={setRawTransaction}
        rawTxColor={rawTxColor}
        setRawTxColor={setRawTxColor}
        onSendRawTransaction={handleSendRawTransaction}
        transactions={transactions}
        onAddTransaction={handleAddTransaction}
        onRemoveTransaction={handleRemoveTransaction}
        newTxid={newTxid}
        setNewTxid={setNewTxid}
        selectedColor={selectedColor}
        setSelectedColor={setSelectedColor}
        networkStatus={networkStatus}
        PANEL_WIDTH={PANEL_WIDTH}
        TRANSACTION_COLORS={TRANSACTION_COLORS}
      />
      
      {/* Toggle Button */}
      <ToggleButton 
        isPanelOpen={isPanelOpen}
        setIsPanelOpen={setIsPanelOpen}
      />
      
      {/* Title */}
      <Box sx={{ position: 'relative', mb: 1 }}>
        <Typography variant="h5" sx={{ textAlign: 'center', fontWeight: 'bold' }}>
          51% Atakos Įrankis
        </Typography>
        {/* Status indicator */}
        {networkStatus && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1, gap: 2 }}>
            {networkStatus.publicTip && (
              <Typography variant="body2" className="bg-green-700 p-1 px-2 rounded-md text-white">
                Viešas: {networkStatus.publicTip.height || 'N/A'}
              </Typography>
            )}
            {networkStatus.privateTip && (
              <Typography variant="body2" className="bg-red-700 p-1 px-2 rounded-md text-white">
                Privatus: {networkStatus.privateTip.height || 'N/A'}
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {/* Main Blockchain Visualization */}
      <ReactFlowBlockchain 
        chainBlocks={chainBlocks}
        chainTips={chainTips}
        transactions={transactions}
      />
    </Box>
  );
}