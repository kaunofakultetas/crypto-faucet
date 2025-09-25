import React, { useState, useEffect, useRef } from 'react';
import { Typography, TextField, Button, Box, MenuItem, Select, InputLabel, FormControl, Grid } from '@mui/material';
import crypto from 'crypto-js';
import { RoundedBox } from './components/RoundedBox';
import { GiMining } from "react-icons/gi";
import AddCircleOutlinedIcon from '@mui/icons-material/AddCircleOutlined';

// Blockchain Simulator Component
const SHA256Train = () => {
  const lithuanianNames = ['Mantas', 'Agnė', 'Jonas', 'Gabija', 'Rokas', 'Eglė', 'Saulius', 'Simona'];

  // State to track the visibility and position of the "Nukopijuota!" message
  const [copiedMessage, setCopiedMessage] = useState({ visible: false, x: 0, y: 0 });

  // Helper function to generate random transaction data
  const generateRandomTransaction = () => {
    const sender = lithuanianNames[Math.floor(Math.random() * lithuanianNames.length)];
    const receiver = lithuanianNames[Math.floor(Math.random() * lithuanianNames.length)];
    const amount = Math.floor(Math.random() * 10) + 1; // Random between 1-10 BTC
    return `2) ${sender} ---> ${receiver} (${amount}BTC)`;
  };

  // Helper function to generate coinbase transaction (fixed at 50BTC)
  const generateCoinbaseTransaction = (receiver) => {
    return `1) Nauja kriptovaliuta ---> ${receiver} (50BTC)`;
  };

  // Helper function to calculate SHA-256 hash based on new format
  const calculateHash = (previousHash, nonce, data) => {
    return crypto.SHA256(`${previousHash}\n${nonce}\n${data}`).toString();
  };

  // Function to create the genesis block
  const createGenesisBlock = () => {
    const data = `${generateCoinbaseTransaction('Satoshi')}`;
    const hash = calculateHash('0', 0, data);
    return {
      data,
      previousHash: '0',
      nonce: 0,
      hash,
    };
  };

  // Function to create the first block
  const createFirstBlock = (genesisBlock) => {
    const coinbaseTransaction = generateCoinbaseTransaction(lithuanianNames[Math.floor(Math.random() * lithuanianNames.length)]);
    const additionalTransaction = `2) Satoshi ---> ${lithuanianNames[Math.floor(Math.random() * lithuanianNames.length)]} (2BTC)`;
    const data = `${coinbaseTransaction}\n${additionalTransaction}`;
    const hash = calculateHash(genesisBlock.hash, 0, data);
    return {
      data,
      previousHash: genesisBlock.hash,
      nonce: 0,
      hash,
    };
  };

  const loadExampleBlockchain = () => {
    fetch(`/api/get-example-blockchain`)
      .then(response => response.json())
      .then(data => {
        setBlocks(data);
      })
      .catch(error => {
        console.error('Error fetching example blockchain:', error)
      })
  }

  // Initialize state for blocks
  const [blocks, setBlocks] = useState(() => {
    const genesisBlock = createGenesisBlock();
    const firstBlock = createFirstBlock(genesisBlock);
    return [genesisBlock, firstBlock];
  });

  const [newBlockData, setNewBlockData] = useState('');
  const [difficulty, setDifficulty] = useState(4); // Default difficulty is 4
  const minimapRef = useRef(null);

  // Function to validate a block's hash based on the difficulty
  const isValidHash = (hash) => {
    return hash.startsWith('0'.repeat(difficulty));
  };

  // Function to recalculate the hashes and previous hashes of all blocks starting from the modified block
  const recalculateFromIndex = (updatedBlocks, startIndex) => {
    for (let i = startIndex; i < updatedBlocks.length; i++) {
      // Recalculate the previous hash
      updatedBlocks[i].previousHash = i > 0 ? updatedBlocks[i - 1].hash : '0';

      // Recalculate the hash for the current block using the new hashing format
      updatedBlocks[i].hash = calculateHash(
        updatedBlocks[i].previousHash,
        updatedBlocks[i].nonce,
        updatedBlocks[i].data
      );
    }
  };

  // Function to modify block data and recalculate subsequent blocks
  const modifyBlockData = (blockIndex, event) => {
    const newData = event.target.value;

    // Copy the entire blockchain state
    const updatedBlocks = [...blocks];

    // Modify the block data
    updatedBlocks[blockIndex] = {
      ...updatedBlocks[blockIndex],
      data: newData,
    };

    // Recalculate hashes from the modified block onwards
    recalculateFromIndex(updatedBlocks, blockIndex);

    // Update the state with the recalculated blockchain
    setBlocks(updatedBlocks);
  };

  // Function to modify block nonce and recalculate subsequent blocks
  const modifyBlockNonce = (blockIndex, event) => {
    const newNonce = event.target.value;

    // Copy the entire blockchain state
    const updatedBlocks = [...blocks];

    // Modify the block nonce
    updatedBlocks[blockIndex] = {
      ...updatedBlocks[blockIndex],
      nonce: newNonce,
    };

    // Recalculate hashes from the modified block onwards
    recalculateFromIndex(updatedBlocks, blockIndex);

    // Update the state with the recalculated blockchain
    setBlocks(updatedBlocks);
  };

  // Function to mine a block until it gets a valid hash and recalculate subsequent blocks
  const mineBlock = (blockIndex) => {
    const updatedBlocks = [...blocks];
    let block = updatedBlocks[blockIndex];
    let newNonce = 0;
    let newHash = block.hash;

    // Continue mining until a valid hash is found
    while (!isValidHash(newHash)) {
      newNonce++;
      newHash = calculateHash(block.previousHash, newNonce, block.data);
    }

    // Update the mined block
    updatedBlocks[blockIndex] = { ...block, nonce: newNonce, hash: newHash };

    // Recalculate hashes for subsequent blocks
    recalculateFromIndex(updatedBlocks, blockIndex + 1);

    // Update the state with the recalculated blockchain
    setBlocks(updatedBlocks);
  };

  // Function to add a new block to the chain and recalculate subsequent blocks
  const addBlock = () => {
    const lastBlock = blocks[blocks.length - 1];
    const nonce = 0;
    const transactionText = `${generateCoinbaseTransaction(lithuanianNames[Math.floor(Math.random() * lithuanianNames.length)])}\n${generateRandomTransaction()}`;
    const data = newBlockData || transactionText;
    const hash = calculateHash(lastBlock.hash, nonce, data);

    const newBlock = {
      data,
      previousHash: lastBlock.hash,
      nonce,
      hash,
    };

    // Add the new block to the blockchain
    const updatedBlocks = [...blocks, newBlock];

    // Update the state with the recalculated blockchain
    setBlocks(updatedBlocks);
    setNewBlockData('');
  };

  // Function to copy the block's raw data (what gets hashed) and show the "Nukopijuota!" message
  const copyBlockData = (block, event) => {
    const textToCopy = `${block.previousHash}\n${block.nonce}\n${block.data}`;
    navigator.clipboard.writeText(textToCopy);

    // Get the mouse position and adjust it with the scroll position
    const { clientX, clientY } = event;
    const adjustedX = clientX + window.scrollX;
    const adjustedY = clientY + window.scrollY;

    // Show the "Nukopijuota!" message at the cursor position
    setCopiedMessage({ visible: true, x: adjustedX, y: adjustedY - 10 }); // Offset above the cursor

    // Hide the message after 2 seconds
    setTimeout(() => {
      setCopiedMessage({ visible: false, x: 0, y: 0 });
    }, 2000);
  };

  // Synchronize minimap scroll with window scroll
  const handleScroll = () => {
    if (minimapRef.current) {
      const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
      const minimapScrollHeight = minimapRef.current.scrollHeight - minimapRef.current.clientHeight;
      const scrollRatio = window.scrollY / documentHeight;
      minimapRef.current.scrollTop = scrollRatio * minimapScrollHeight;
    }
  };

  // Set up scroll listener on window
  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <Grid container spacing={2} className="max-w-7xl mx-auto">
      {/* "Nukopijuota!" Message */}
      {copiedMessage.visible && (
        <div
          className="absolute bg-black text-white px-2 py-1 rounded pointer-events-none z-50"
          style={{
            top: `${copiedMessage.y}px`,
            left: `${copiedMessage.x}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          Nukopijuota!
        </div>
      )}

      {/* Main Blockchain View */}
      <Grid item xs={9}>
        {/* Header */}
        <div className="mx-auto p-4 min-w-80 max-w-2xl w-full">
          <Typography 
            className="text-[#78003F] text-center" 
            sx={{ fontSize: 45, fontWeight: 600, marginBottom: 3 }}
          >
            Blokų Grandinės <br /> Simuliatorius
          </Typography>
        </div>

        {/* Difficulty Selector */}
        <RoundedBox className="w-full max-w-6xl p-6" sx={{ width: 1000, maxWidth: '95vw' }}>
          <FormControl fullWidth sx={{ marginBottom: 2 }}>
            <InputLabel>Sudėtingumas - (Pradiniai Nuliukai)</InputLabel>
            <Select
              value={difficulty}
              label="Sudėtingumas - (Pradiniai Nuliukai)"
              onChange={(e) => setDifficulty(e.target.value)}
            >
              {[1, 2, 3, 4, 5].map((num) => (
                <MenuItem key={num} value={num}>
                  {num}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button variant="contained" color="primary" onClick={() => loadExampleBlockchain()}>
              Užkrauti pavyzdinę blokų grandinę
            </Button>

            <Button variant="contained" color="primary" onClick={() => window.open('https://emn178.github.io/online-tools/sha256.html', '_blank')}>
              SHA256 Online Įrankis
            </Button>
          </Box>
        </RoundedBox>

        {/* Main Blockchain Content */}
        <Box>
          {/* Render each block in the blockchain */}
          {blocks.map((block, index) => {
            const isValid = isValidHash(block.hash);
            return (
              <RoundedBox key={index} className="w-full max-w-6xl p-6" sx={{ width: 1000, maxWidth: '95vw' }}>
                <div className={`border rounded-lg p-6 mb-4 ${isValid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <Typography variant="h6" className="mb-4">
                    Blokas #{index} &emsp;&emsp; - &emsp;&emsp;({block.hash.substring(0, 12)}....{block.hash.substring(52, 64)})
                  </Typography>
                  
                  <Typography variant="body2" className="mb-2">
                    <strong>Ankstesnio Bloko Maišos Kodas (SHA256):</strong> {block.previousHash}
                  </Typography>
                  
                  <Typography variant="body2" className="mb-2">
                    <strong>Šio Bloko Maišos Kodas (SHA256):</strong> {block.hash}
                  </Typography>
                  
                  <div className="mt-6">
                    <TextField
                      fullWidth
                      variant="outlined"
                      value={block.nonce}
                      label="Numeris (Nonce):"
                      onChange={(e) => modifyBlockNonce(index, e)}
                      sx={{ marginBottom: 2 }}
                    />
                    
                    <TextField
                      fullWidth
                      multiline
                      minRows={2}
                      variant="outlined"
                      value={block.data}
                      label="Transakcijos:"
                      onChange={(e) => modifyBlockData(index, e)}
                      sx={{ marginBottom: 2 }}
                    />
                  </div>

                  <div className="flex justify-between mt-4">
                    <Button 
                      variant="contained" 
                      color="primary" 
                      onClick={(event) => copyBlockData(block, event)}
                      className="whitespace-nowrap"
                    >
                      Kopijuoti Bloko<br />Tekstą
                    </Button>

                    <Button 
                      variant="contained" 
                      color="primary" 
                      disabled={isValid} 
                      onClick={() => mineBlock(index)}
                      className="px-8"
                    >
                      <GiMining size={35} />
                    </Button>
                  </div>
                </div>
              </RoundedBox>
            );
          })}
        </Box>

        {/* Add New Block Button */}
        <RoundedBox className="w-full max-w-6xl flex justify-center mb-20" sx={{ width: 1000, maxWidth: '95vw' }}>
          <Button
            variant="contained"
            color="primary" 
            onClick={addBlock}
            className="px-8 py-4 w-[500px] h-[50px]"
            sx={{ fontSize: 20 }}
          >
            Pridėti Naują Bloką 
            <AddCircleOutlinedIcon className="text-3xl ml-2" />
          </Button>
        </RoundedBox>
      </Grid>

      {/* Blockchain Minimap */}
      <Grid item xs={3}>
        <div 
          ref={minimapRef}
          className="fixed top-24 right-4 flex flex-col items-center bg-gray-100 rounded-lg p-4 shadow-lg max-h-[80vh] overflow-y-auto"
        >
          <Typography variant="h6" className="text-center mb-4">
            Blokų Grandinės<br />
            Minimap'as
          </Typography>
          
          <div className="flex flex-col items-center space-y-2">
            {blocks.map((block, index) => {
              const isValid = isValidHash(block.hash);
              return (
                <div
                  key={index}
                  className={`w-12 h-12 flex items-center justify-center font-bold text-white rounded ${
                    isValid ? 'bg-green-600' : 'bg-red-600'
                  }`}
                >
                  #{index}
                </div>
              );
            })}
          </div>
        </div>
      </Grid>
    </Grid>
  );
};

export default SHA256Train;