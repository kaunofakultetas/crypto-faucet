// -----------------------------------------------------------
//  [*] Pages — Blockchain Simulator (route /sha256)
//
//  An interactive proof-of-work teaching toy: a chain of
//  SHA-256 blocks that students edit, break and re-mine.
//  Everything runs client-side with crypto-js — the only
//  backend call is loading the pre-mined example chain
//  (GET /api/get-example-blockchain).
//
//  The hash preimage is load-bearing: calculateHash hashes
//  `previousHash\nnonce\ndata` (real newlines) and the
//  "Kopijuoti Bloko Tekstą" button copies that exact string,
//  so students can reproduce any block hash in the external
//  SHA256 online tool. The backend's example blocks were
//  mined against the same format.
//
//  Split into (root component last):
//
//    LITHUANIAN_NAMES            — cast for the transactions
//    randomName                  — random cast member
//    generateCoinbaseTransaction — "1) Nauja kriptovaliuta..."
//    generateRandomTransaction   — "2) A ---> B (nBTC)" line
//    calculateHash               — SHA-256 over the preimage
//    createGenesisBlock          — block #0 (Satoshi coinbase)
//    createFirstBlock            — block #1 chained onto #0
//    useBlockchain               — chain state + mining logic
//    CopiedToast                 — "Nukopijuota!" bubble
//    ControlPanel                — difficulty + tool buttons
//    BlockCard                   — one editable block card
//    AddBlockButton              — appends a new block
//    Minimap                     — fixed chain overview
//    BlockchainSimulator         — layout + wiring
//                                  (default export)
// -----------------------------------------------------------

import React, { useState, useEffect, useRef } from 'react';
import { Typography, TextField, Button, Box, MenuItem, Select, InputLabel, FormControl } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import crypto from 'crypto-js';

import { RoundedBox } from './components/RoundedBox';
import { GiMining } from "react-icons/gi";
import AddCircleOutlinedIcon from '@mui/icons-material/AddCircleOutlined';






// Cast of characters for the generated transactions — sender
// and receiver are drawn independently, so someone can pay
// themselves
const LITHUANIAN_NAMES = ['Mantas', 'Agnė', 'Jonas', 'Gabija', 'Rokas', 'Eglė', 'Saulius', 'Simona'];
const randomName = () => LITHUANIAN_NAMES[Math.floor(Math.random() * LITHUANIAN_NAMES.length)];


// The coinbase line — every block's first transaction, the
// reward fixed at 50BTC
const generateCoinbaseTransaction = (receiver) => {
  return `1) Nauja kriptovaliuta ---> ${receiver} (50BTC)`;
};


// A random 1-10 BTC payment — every generated block's second
// transaction line
const generateRandomTransaction = () => {
  const amount = Math.floor(Math.random() * 10) + 1;
  return `2) ${randomName()} ---> ${randomName()} (${amount}BTC)`;
};


// The hashing rule of the whole page: SHA-256 over
// `previousHash\nnonce\ndata` (real newlines). This exact
// string is what the copy button puts on the clipboard, and
// what the backend's example blocks were mined against. The
// nonce arrives as a number when mined but as a raw string
// when typed — both interpolate identically
const calculateHash = (previousHash, nonce, data) => {
  return crypto.SHA256(`${previousHash}\n${nonce}\n${data}`).toString();
};







// -----------------------------------------------------------
// createGenesisBlock
// -----------------------------------------------------------
//
// Block #0: previousHash '0' and a lone Satoshi coinbase.
// Nonce stays 0 — deliberately unmined, so the page opens
// with red blocks for the students to mine.
//
// Used by:
//   - useBlockchain (below) — initial chain state
// -----------------------------------------------------------

const createGenesisBlock = () => {
  const data = generateCoinbaseTransaction('Satoshi');

  return {
    data,
    previousHash: '0',
    nonce: 0,
    hash: calculateHash('0', 0, data),
  };
};







// -----------------------------------------------------------
// createFirstBlock
// -----------------------------------------------------------
//
// Block #1, chained onto the genesis hash: a random coinbase
// plus a fixed 2BTC spend from Satoshi. Also unmined.
//
// Used by:
//   - useBlockchain (below) — initial chain state
// -----------------------------------------------------------

const createFirstBlock = (genesisBlock) => {
  const data = `${generateCoinbaseTransaction(randomName())}\n2) Satoshi ---> ${randomName()} (2BTC)`;

  return {
    data,
    previousHash: genesisBlock.hash,
    nonce: 0,
    hash: calculateHash(genesisBlock.hash, 0, data),
  };
};







// -----------------------------------------------------------
// useBlockchain
// -----------------------------------------------------------
//
//   const {
//     blocks,                — the chain, oldest first
//     difficulty,            — required leading hash zeros
//     setDifficulty,         — 1-5 from the selector
//     isValidHash,           — does a hash meet difficulty?
//     modifyBlockField,      — (index, 'data'|'nonce', event)
//     mineBlock,             — (index) brute-force the nonce
//     addBlock,              — append an unmined block
//     loadExampleBlockchain, — replace chain from the backend
//     exampleLoading,        — that request is in flight
//     exampleError,          — it failed (chain untouched)
//   } = useBlockchain()
//
// Used by:
//   - BlockchainSimulator (below)
// -----------------------------------------------------------

function useBlockchain() {

  // The chain — starts as an unmined two-block chain so the
  // page opens with something to mine
  const [blocks, setBlocks] = useState(() => {
    const genesisBlock = createGenesisBlock();
    return [genesisBlock, createFirstBlock(genesisBlock)];
  });

  // Difficulty = required count of leading hash zeros
  const [difficulty, setDifficulty] = useState(4);


  // Reads the live difficulty, so moving the selector
  // re-colours every block without touching a single hash
  const isValidHash = (hash) => {
    return hash.startsWith('0'.repeat(difficulty));
  };


  // The ripple: re-link and re-hash every block from
  // startIndex to the end. Blocks keep their old nonce, which
  // is why one upstream edit turns the whole tail red. Mutates
  // the block objects in place — callers fork the array, and
  // the fresh array reference is what triggers the re-render.
  const recalculateFromIndex = (updatedBlocks, startIndex) => {
    for (let i = startIndex; i < updatedBlocks.length; i++) {
      updatedBlocks[i].previousHash = i > 0 ? updatedBlocks[i - 1].hash : '0';
      updatedBlocks[i].hash = calculateHash(
        updatedBlocks[i].previousHash,
        updatedBlocks[i].nonce,
        updatedBlocks[i].data
      );
    }
  };


  // One handler for both editable fields ('data' and 'nonce') —
  // re-hash the edited block and everything after it on every
  // keystroke. A typed nonce stays a raw string (no parseInt),
  // which hashes the same as a number; see calculateHash
  const modifyBlockField = (blockIndex, field, event) => {
    const updatedBlocks = [...blocks];
    updatedBlocks[blockIndex] = { ...updatedBlocks[blockIndex], [field]: event.target.value };
    recalculateFromIndex(updatedBlocks, blockIndex);
    setBlocks(updatedBlocks);
  };


  // Proof-of-work: brute-force the nonce from 0 until the hash
  // gains its zeros. Runs synchronously on the UI thread, so
  // difficulty 5 visibly freezes the tab for a moment — that
  // pause is part of the lesson.
  const mineBlock = (blockIndex) => {
    const updatedBlocks = [...blocks];
    const block = updatedBlocks[blockIndex];
    let newNonce = 0;
    let newHash = block.hash;

    while (!isValidHash(newHash)) {
      newNonce++;
      newHash = calculateHash(block.previousHash, newNonce, block.data);
    }

    // Only the tail after this block needs the ripple — this
    // block was just re-hashed by the loop
    updatedBlocks[blockIndex] = { ...block, nonce: newNonce, hash: newHash };
    recalculateFromIndex(updatedBlocks, blockIndex + 1);
    setBlocks(updatedBlocks);
  };


  // Appends an unmined block (nonce 0 → arrives red) chained
  // onto the current tail, with a random coinbase + payment
  const addBlock = () => {
    const lastBlock = blocks[blocks.length - 1];
    const data = `${generateCoinbaseTransaction(randomName())}\n${generateRandomTransaction()}`;

    const newBlock = {
      data,
      previousHash: lastBlock.hash,
      nonce: 0,
      hash: calculateHash(lastBlock.hash, 0, data),
    };

    setBlocks([...blocks, newBlock]);
  };


  // Replaces the WHOLE chain with the pre-mined example from
  // the backend. A mutation, not a query: the student decides
  // when their edits are thrown away, and on failure the
  // current chain stays untouched while the control panel
  // shows the error.
  const exampleChain = useMutation({
    mutationFn: async () => (await axios.get('/api/get-example-blockchain')).data,
    onSuccess: (data) => setBlocks(data),
  });


  return {
    blocks,
    difficulty,
    setDifficulty,
    isValidHash,
    modifyBlockField,
    mineBlock,
    addBlock,
    loadExampleBlockchain: exampleChain.mutate,
    exampleLoading: exampleChain.isPending,
    exampleError: exampleChain.isError,
  };
}







// -----------------------------------------------------------
// CopiedToast
// -----------------------------------------------------------
//
// The "Nukopijuota!" bubble that flashes at the cursor after
// copying a block's text; renders nothing while hidden. It is
// positioned absolutely in the document (not fixed) — nothing
// in the card sets `position`, so the scroll-adjusted coords
// resolve against the document.
//
// Used by:
//   - BlockCard (below)
// -----------------------------------------------------------

function CopiedToast({ copiedMessage }) {

  if (!copiedMessage.visible) {
    return null;
  }

  return (
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
  );
}







// -----------------------------------------------------------
// ControlPanel
// -----------------------------------------------------------
//
// The difficulty selector (how many leading zeros a hash
// needs) plus the tool buttons: load the pre-mined example
// chain from the backend (disabled while the request runs,
// with the failure reported right under it), or open the
// external SHA256 tool students use to verify copied block
// text.
//
// Used by:
//   - BlockchainSimulator (below)
// -----------------------------------------------------------

function ControlPanel({ difficulty, onDifficultyChange, onLoadExample, exampleLoading, exampleError }) {
  return (
    <RoundedBox className="w-full max-w-6xl p-6" sx={{ width: 1000, maxWidth: '95vw' }}>

      <FormControl fullWidth sx={{ marginBottom: 2 }}>
        <InputLabel>Sudėtingumas - (Pradiniai Nuliukai)</InputLabel>
        <Select
          value={difficulty}
          label="Sudėtingumas - (Pradiniai Nuliukai)"
          onChange={(e) => onDifficultyChange(e.target.value)}
        >
          {[1, 2, 3, 4, 5].map((num) => (
            <MenuItem key={num} value={num}>
              {num}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="contained" color="primary" onClick={onLoadExample} disabled={exampleLoading}>
          {exampleLoading ? 'Kraunama…' : 'Užkrauti pavyzdinę blokų grandinę'}
        </Button>

        <Button variant="contained" color="primary" onClick={() => window.open('https://emn178.github.io/online-tools/sha256.html', '_blank')}>
          SHA256 Online Įrankis
        </Button>
      </Box>

      {exampleError && (
        <Typography color="error" sx={{ marginTop: 2 }}>
          Nepavyko užkrauti pavyzdinės blokų grandinės. Bandykite dar kartą.
        </Typography>
      )}

    </RoundedBox>
  );
}







// -----------------------------------------------------------
// BlockCard
// -----------------------------------------------------------
//
// One editable block: both hashes, the nonce and transactions
// inputs, the copy button and the pickaxe mining button
// (disabled once the block is already valid). Green while
// valid, red once broken. Owns the copy flow end-to-end: puts
// the exact hash preimage on the clipboard and flashes its
// own "Nukopijuota!" toast at the cursor.
//
// Used by:
//   - BlockchainSimulator (below) — one per block
// -----------------------------------------------------------

function BlockCard({ block, index, isValid, onNonceChange, onDataChange, onMine }) {

  const [copiedMessage, setCopiedMessage] = useState({ visible: false, x: 0, y: 0 });


  // Copies the block's exact hash preimage (what calculateHash
  // hashes) and flashes the toast 10px above the cursor for
  // 2 seconds — coords are document-absolute (cursor + scroll)
  const copyBlockData = (event) => {
    navigator.clipboard.writeText(`${block.previousHash}\n${block.nonce}\n${block.data}`);

    setCopiedMessage({
      visible: true,
      x: event.clientX + window.scrollX,
      y: event.clientY + window.scrollY - 10,
    });

    setTimeout(() => {
      setCopiedMessage({ visible: false, x: 0, y: 0 });
    }, 2000);
  };


  return (
    <RoundedBox className="w-full max-w-6xl p-6" sx={{ width: 1000, maxWidth: '95vw' }}>

      <CopiedToast copiedMessage={copiedMessage} />

      <div className={`border rounded-lg p-6 mb-4 ${isValid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>

        {/* Title — first and last 12 characters of the hash */}
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
            onChange={onNonceChange}
            sx={{ marginBottom: 2 }}
          />

          <TextField
            fullWidth
            multiline
            minRows={2}
            variant="outlined"
            value={block.data}
            label="Transakcijos:"
            onChange={onDataChange}
            sx={{ marginBottom: 2 }}
          />
        </div>

        <div className="flex justify-between mt-4">
          <Button
            variant="contained"
            color="primary"
            onClick={copyBlockData}
            className="whitespace-nowrap"
          >
            Kopijuoti Bloko<br />Tekstą
          </Button>

          <Button
            variant="contained"
            color="primary"
            disabled={isValid}
            onClick={onMine}
            className="px-8"
          >
            <GiMining size={35} />
          </Button>
        </div>

      </div>
    </RoundedBox>
  );
}







// -----------------------------------------------------------
// AddBlockButton
// -----------------------------------------------------------
//
// Used by:
//   - BlockchainSimulator (below) — under the last block
// -----------------------------------------------------------

function AddBlockButton({ onClick }) {
  return (
    <RoundedBox className="w-full max-w-6xl flex justify-center mb-20" sx={{ width: 1000, maxWidth: '95vw' }}>
      <Button
        variant="contained"
        color="primary"
        onClick={onClick}
        className="px-8 py-4 w-[500px] h-[50px]"
        sx={{ fontSize: 20 }}
      >
        Pridėti Naują Bloką
        <AddCircleOutlinedIcon className="text-3xl ml-2" />
      </Button>
    </RoundedBox>
  );
}







// -----------------------------------------------------------
// Minimap
// -----------------------------------------------------------
//
// Fixed overview of the whole chain: one numbered square per
// block, green/red by validity. Scroll-syncs itself: the
// window's scroll ratio is mapped onto its own scrollbar, so
// it tracks the page as the chain grows beyond one screen.
//
// Used by:
//   - BlockchainSimulator (below) — the right column
// -----------------------------------------------------------

function Minimap({ blocks, isValidHash }) {

  const minimapRef = useRef(null);


  // Window scroll drives the minimap scroll; removed on unmount
  useEffect(() => {
    const handleScroll = () => {
      if (minimapRef.current) {
        const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
        const minimapScrollHeight = minimapRef.current.scrollHeight - minimapRef.current.clientHeight;
        minimapRef.current.scrollTop = (window.scrollY / documentHeight) * minimapScrollHeight;
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);


  return (
    <div
      ref={minimapRef}
      className="fixed top-24 right-4 flex flex-col items-center bg-gray-100 rounded-lg p-4 shadow-lg max-h-[80vh] overflow-y-auto"
    >
      <Typography variant="h6" className="text-center mb-4">
        Blokų Grandinės<br />
        Minimap'as
      </Typography>

      <div className="flex flex-col items-center space-y-2">
        {blocks.map((block, index) => (
          <div
            key={index}
            className={`w-12 h-12 flex items-center justify-center font-bold text-white rounded ${
              isValidHash(block.hash) ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            #{index}
          </div>
        ))}
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// BlockchainSimulator (default export)
// -----------------------------------------------------------
//
// Pure layout and wiring — the chain state and all the logic
// come from useBlockchain (above).
//
// Used by:
//   - main.jsx — route /sha256 (imported as
//     BlockchainSimulatorPage)
// -----------------------------------------------------------

export default function BlockchainSimulator() {

  const {
    blocks, difficulty, setDifficulty, isValidHash,
    modifyBlockField, mineBlock, addBlock,
    loadExampleBlockchain, exampleLoading, exampleError,
  } = useBlockchain();


  return (
    // A single centered column — the minimap doesn't need a
    // column of its own, it floats position:fixed at the
    // page's top-right regardless of where it is rendered
    <div className="mx-auto flex max-w-7xl flex-col items-center">

      {/* Title */}
      <div className="mx-auto p-4 min-w-80 max-w-2xl w-full">
        <Typography
          className="text-[#78003F] text-center"
          sx={{ fontSize: 45, fontWeight: 600, marginBottom: 3 }}
        >
          Blokų Grandinės <br /> Simuliatorius
        </Typography>
      </div>

      <ControlPanel
        difficulty={difficulty}
        onDifficultyChange={setDifficulty}
        onLoadExample={loadExampleBlockchain}
        exampleLoading={exampleLoading}
        exampleError={exampleError}
      />

      {/* One card per block — green when the hash meets the
          difficulty, red once the chain is broken */}
      <Box>
        {blocks.map((block, index) => (
          <BlockCard
            key={index}
            block={block}
            index={index}
            isValid={isValidHash(block.hash)}
            onNonceChange={(event) => modifyBlockField(index, 'nonce', event)}
            onDataChange={(event) => modifyBlockField(index, 'data', event)}
            onMine={() => mineBlock(index)}
          />
        ))}
      </Box>

      <AddBlockButton onClick={addBlock} />

      <Minimap blocks={blocks} isValidHash={isValidHash} />

    </div>
  );
}
