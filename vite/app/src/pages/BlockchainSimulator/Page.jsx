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
//  Mining runs in animation-frame slices: the tab keeps
//  painting, the pickaxe counts the hashes tried and turns
//  into a stop button — the wait at difficulty 5 is still
//  the lesson, a frozen "page unresponsive" tab is not.
//
//  Styling note: Tailwind utilities on a RoundedBox or a MUI
//  Button lose to the emotion rules on the same element
//  (unlayered CSS beats Tailwind v4's layers), so card sizing
//  lives in sx and the class lists carry only what applies.
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
//                                  (sliced, counted, stoppable)
//    RoundedBox                  — the white card every
//                                  section sits in (styled)
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
import { styled } from '@mui/material/styles';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import crypto from 'crypto-js';

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
//     mining,                — { index, tried } while a search
//                              runs, null when idle
//     stopMining,            — abandon the running search
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

  // The block being mined and how many nonces it has tried —
  // shown on its pickaxe button; null when idle. cancelRef is
  // the stop button's flag, read between animation frames.
  const [mining, setMining] = useState(null);
  const cancelRef = useRef(false);


  // Leaving the page abandons a search in progress
  useEffect(() => () => { cancelRef.current = true; }, []);


  // Reads the live difficulty, so moving the selector
  // re-colours every block without touching a single hash
  const isValidHash = (hash) => {
    return hash.startsWith('0'.repeat(difficulty));
  };


  // The ripple: re-link and re-hash every block from
  // startIndex to the end, as a NEW array of new objects —
  // the blocks held in React state are never written to, so
  // a memoized BlockCard or a functional setBlocks would see
  // the change too. Blocks keep their old nonce, which is why
  // one upstream edit turns the whole tail red.
  const recalculateFromIndex = (blocksIn, startIndex) => {
    const out = blocksIn.slice();
    for (let i = startIndex; i < out.length; i++) {
      const previousHash = i > 0 ? out[i - 1].hash : '0';
      out[i] = { ...out[i], previousHash, hash: calculateHash(previousHash, out[i].nonce, out[i].data) };
    }
    return out;
  };


  // One handler for both editable fields ('data' and 'nonce') —
  // re-hash the edited block and everything after it on every
  // keystroke. A typed nonce stays a raw string (no parseInt),
  // which hashes the same as a number; see calculateHash
  const modifyBlockField = (blockIndex, field, event) => {
    const updatedBlocks = [...blocks];
    updatedBlocks[blockIndex] = { ...updatedBlocks[blockIndex], [field]: event.target.value };
    setBlocks(recalculateFromIndex(updatedBlocks, blockIndex));
  };


  // Proof-of-work: brute-force the nonce from 0 until the hash
  // gains its zeros. Runs in ~16 ms animation-frame slices, so
  // the tab keeps painting: the pickaxe counts the hashes
  // tried and offers a stop — the wait at difficulty 5 (about
  // a million SHA-256s) is still the lesson, a frozen tab is
  // not. The preimage is fixed when the search starts; if the
  // student edits the block meanwhile, the result is dropped
  // rather than committed against the wrong data.
  const mineBlock = (blockIndex) => {
    const block = blocks[blockIndex];
    const prefix = '0'.repeat(difficulty);
    let nonce = 0;
    cancelRef.current = false;
    setMining({ index: blockIndex, tried: 0 });

    const step = () => {
      if (cancelRef.current) {
        setMining(null);
        return;
      }

      const deadline = performance.now() + 16;
      while (performance.now() < deadline) {
        const hash = calculateHash(block.previousHash, nonce, block.data);
        if (hash.startsWith(prefix)) {
          const found = nonce;
          setBlocks((current) => {
            const target = current[blockIndex];
            if (!target || target.previousHash !== block.previousHash || target.data !== block.data) return current;
            const updated = [...current];
            updated[blockIndex] = { ...target, nonce: found, hash };
            // Only the tail after this block needs the ripple —
            // this block was just hashed by the search
            return recalculateFromIndex(updated, blockIndex + 1);
          });
          setMining(null);
          return;
        }
        nonce++;
      }

      setMining({ index: blockIndex, tried: nonce });
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  };

  const stopMining = () => {
    cancelRef.current = true;
  };


  // Appends an unmined block (nonce 0 → arrives red) chained
  // onto the current tail — or onto '0' like a genesis block,
  // should the chain ever be empty — with a random coinbase +
  // payment
  const addBlock = () => {
    const lastHash = blocks.length ? blocks[blocks.length - 1].hash : '0';
    const data = `${generateCoinbaseTransaction(randomName())}\n${generateRandomTransaction()}`;

    const newBlock = {
      data,
      previousHash: lastHash,
      nonce: 0,
      hash: calculateHash(lastHash, 0, data),
    };

    setBlocks([...blocks, newBlock]);
  };


  // Replaces the WHOLE chain with the pre-mined example from
  // the backend. A mutation, not a query: the student decides
  // when their edits are thrown away, and on failure the
  // current chain stays untouched while the control panel
  // shows the error. The answer is checked before it replaces
  // anything — an emptied table (dbgate) or a wrong shape is a
  // failure, not a chain of nothing.
  const exampleChain = useMutation({
    mutationFn: async () => {
      const { data } = await axios.get('/api/get-example-blockchain');
      const wellFormed = Array.isArray(data) && data.length > 0 && data.every(
        (block) => typeof block?.hash === 'string' && typeof block?.previousHash === 'string' && typeof block?.data === 'string',
      );
      if (!wellFormed) throw new Error('Malformed example chain');
      return data;
    },
    onSuccess: (data) => setBlocks(data),
  });


  return {
    blocks,
    difficulty,
    setDifficulty,
    isValidHash,
    modifyBlockField,
    mineBlock,
    mining,
    stopMining,
    addBlock,
    loadExampleBlockchain: exampleChain.mutate,
    exampleLoading: exampleChain.isPending,
    exampleError: exampleChain.isError,
  };
}







// -----------------------------------------------------------
// RoundedBox
// -----------------------------------------------------------
//
// The rounded white card every section of the page sits in.
// Note: the webkitBoxShadow line is INERT — emotion renders
// it as the unknown property "webkit-box-shadow" (the vendor
// key would be WebkitBoxShadow), so only the grey boxShadow
// below it ever applies. Kept as found, documented rather
// than silently changed.
//
// Used by:
//   - ControlPanel / BlockCard / AddBlockButton (below)
// -----------------------------------------------------------

const RoundedBox = styled(Box)(({ theme }) => ({
  background: theme.palette.background.default,
  borderRadius: theme.shape.borderRadius,
  margin: `${theme.spacing(2)} auto`,
  padding: theme.spacing(2),
  minWidth: theme.spacing(40),
  maxWidth: theme.spacing(70),
  width: '100%',
  webkitBoxShadow: '2px 4px 10px 1px rgba(0, 0, 0, 0.47)',
  boxShadow: '2px 4px 10px 1px rgba(201, 201, 201, 0.47)',
  ...theme.typography.body2,
}));







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
    <RoundedBox sx={{ width: 1000, maxWidth: '95vw' }}>

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

        {/* An anchor, not window.open: the anchor form gets an
            implicit noopener, so the tool's page cannot steer
            this tab */}
        <Button
          component="a"
          href="https://emn178.github.io/online-tools/sha256.html"
          target="_blank"
          rel="noopener noreferrer"
          variant="contained"
          color="primary"
        >
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
// (disabled once the block is already valid, or while another
// block is being mined; while THIS block is being mined it
// shows the hashes tried and stops the search on click).
// Green while valid, red once broken. Owns the copy flow
// end-to-end: puts the exact hash preimage on the clipboard
// and flashes its own "Nukopijuota!" toast at the cursor —
// only when the copy actually happened.
//
// Used by:
//   - BlockchainSimulator (below) — one per block
// -----------------------------------------------------------

function BlockCard({ block, index, isValid, mining, miningElsewhere, onNonceChange, onDataChange, onMine, onStop }) {

  const [copiedMessage, setCopiedMessage] = useState({ visible: false, x: 0, y: 0 });


  // Copies the block's exact hash preimage (what calculateHash
  // hashes) and flashes the toast 10px above the cursor for
  // 2 seconds — coords are document-absolute (cursor + scroll).
  // The clipboard API is missing on a plain-http dev host and
  // rejects on denied permission — neither may claim success,
  // or the student verifies a stale clipboard in the SHA256
  // tool and blames the simulator.
  const copyBlockData = async (event) => {
    const { clientX, clientY } = event;
    try {
      await navigator.clipboard.writeText(`${block.previousHash}\n${block.nonce}\n${block.data}`);
    } catch (error) {
      console.warn('Copy failed:', error);
      return;
    }

    setCopiedMessage({
      visible: true,
      x: clientX + window.scrollX,
      y: clientY + window.scrollY - 10,
    });

    setTimeout(() => {
      setCopiedMessage({ visible: false, x: 0, y: 0 });
    }, 2000);
  };


  return (
    <RoundedBox sx={{ width: 1000, maxWidth: '95vw' }}>

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
            disabled={isValid || miningElsewhere}
            onClick={mining !== null ? onStop : onMine}
            sx={{ textTransform: 'none' }}
          >
            {mining !== null
              ? `Stabdyti · ${mining.toLocaleString('lt-LT')} bandymų`
              : <GiMining size={35} />}
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
    <RoundedBox className="flex justify-center" sx={{ width: 1000, maxWidth: '95vw' }}>
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
// Shown from the xl breakpoint up only — on a narrower window
// it floated over the cards' column and covered the pickaxe;
// the page reserves its width with xl:pr-56.
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
      className="hidden xl:flex fixed top-24 right-4 z-30 flex-col items-center bg-gray-100 rounded-lg p-4 shadow-lg max-h-[80vh] overflow-y-auto"
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
    modifyBlockField, mineBlock, mining, stopMining, addBlock,
    loadExampleBlockchain, exampleLoading, exampleError,
  } = useBlockchain();


  return (
    // A single centered column — the minimap doesn't need a
    // column of its own, it floats position:fixed at the
    // page's top-right regardless of where it is rendered;
    // the xl right padding keeps the cards out from under it
    <div className="mx-auto flex max-w-7xl flex-col items-center xl:pr-56">

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
            mining={mining?.index === index ? mining.tried : null}
            miningElsewhere={mining !== null && mining.index !== index}
            onNonceChange={(event) => modifyBlockField(index, 'nonce', event)}
            onDataChange={(event) => modifyBlockField(index, 'data', event)}
            onMine={() => mineBlock(index)}
            onStop={stopMining}
          />
        ))}
      </Box>

      <AddBlockButton onClick={addBlock} />

      <Minimap blocks={blocks} isValidHash={isValidHash} />

    </div>
  );
}
