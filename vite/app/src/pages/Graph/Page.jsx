// -----------------------------------------------------------
//  [*] Pages — Transaction Graph (route /graph/:network)
//
//  Entry point of the transaction-flow visualization: a
//  compact date slider bar on top and the graph below it,
//  rooted at the network's faucet address (resolved via
//  GET /api/evm/<network>/faucet-balance — cache key shared
//  with the faucet page, so it's usually instant).
//
//  The slider offers ONLY the days the faucet address itself
//  transacted on (GET /api/evm/<network>/transaction-days,
//  bucketed with the browser's timezone offset) plus today,
//  and defaults to today. Days without root activity would render a lone
//  faucet node, so they are not listed. The picked day
//  travels into every graph fetch as a half-open [from, to)
//  unix window computed from the STUDENT'S local midnight;
//  viewing a past day freezes the live sweeps and skips the
//  Etherscan refresh — history can't change.
//
//  Split into (root component last):
//
//    todayString   — today as local 'YYYY-MM-DD'
//    rangeOfDay    — 'YYYY-MM-DD' → local-day unix window
//    DateSliderBar — the top bar: searchable day dropdown,
//                    −/+ steppers and the day slider
//    GraphPage     — address + day list + picked-day state
//                    (default export)
// -----------------------------------------------------------

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { Autocomplete, Box, IconButton, Slider, TextField } from '@mui/material';
import TodayIcon from '@mui/icons-material/Today';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

import CryptoFlowGraph from './CryptoFlowGraph';


// The round brand-colored day-stepper buttons, matching the
// graph's zoom buttons
const STEP_BUTTON_SX = {
  bgcolor: 'primary.main',
  color: 'common.white',
  '&:hover': { bgcolor: 'primary.dark' },
  '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
  width: 26,
  height: 26,
  borderRadius: '50%',
};







// -----------------------------------------------------------
// todayString
// -----------------------------------------------------------
//
// Today as 'YYYY-MM-DD' in the student's LOCAL timezone —
// matches the buckets transaction-days returns for the same
// tz_offset.
//
// Used by:
//   - GraphPage (below)
// -----------------------------------------------------------

function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}







// -----------------------------------------------------------
// rangeOfDay
// -----------------------------------------------------------
//
// 'YYYY-MM-DD' → that day's half-open unix window
// [00:00, next 00:00) in the student's local timezone.
// The Date(y, m, d) constructor handles month bounds and DST.
//
// Used by:
//   - GraphPage (below)
// -----------------------------------------------------------

function rangeOfDay(dayString) {
  const [year, month, day] = dayString.split('-').map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);

  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
  };
}







// -----------------------------------------------------------
// DateSliderBar
// -----------------------------------------------------------
//
// Two centered rows with three ways to pick a day, all over
// the SAME used-day list:
//
//   row 1 — the searchable dropdown (Autocomplete, newest
//           first) — type a fragment like "07-" to filter
//   row 2 — the − / + steppers (exactly one used day earlier
//           / later) around the slider; positions are indices
//           into `days`, rightmost = newest. The tooltip
//           previews WHILE dragging, the graph refetches only
//           on release.
//
// With a single known day there is nothing to step or slide —
// only the dropdown row renders.
//
// Used by:
//   - GraphPage (below)
// -----------------------------------------------------------

function DateSliderBar({ days, selectedDay, onCommit }) {

  const [draftIndex, setDraftIndex] = useState(null);

  const selectedIndex = Math.max(0, days.indexOf(selectedDay));
  const shownIndex = draftIndex ?? selectedIndex;

  const commitIndex = (index) => {
    const clamped = Math.min(Math.max(index, 0), days.length - 1);
    setDraftIndex(null);
    onCommit(days[clamped]);
  };

  const dayText = (day) => (day === todayString() ? `${day} (šiandien)` : day);

  return (
    <Box className="card-surface mx-auto mb-4 w-full max-w-[760px] px-6 py-4">

      {/* Row 1: the searchable day picker, centered */}
      <Box className="flex items-center justify-center gap-2">
        <TodayIcon sx={{ color: '#78003F' }} />
        <Autocomplete
          size="small"
          options={[...days].reverse()}
          value={selectedDay}
          onChange={(_, value) => value && onCommit(value)}
          getOptionLabel={dayText}
          disableClearable
          sx={{ width: 280 }}
          renderInput={(params) => <TextField {...params} label="Data" />}
        />
      </Box>

      {/* Row 2: steppers + the day slider */}
      {days.length > 1 && (
        <Box className="mt-4 flex items-center gap-3">
          <IconButton
            size="small"
            aria-label="Ankstesnė diena"
            onClick={() => commitIndex(selectedIndex - 1)}
            disabled={selectedIndex === 0}
            sx={STEP_BUTTON_SX}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>

          <Slider
            value={shownIndex}
            min={0}
            max={days.length - 1}
            step={1}
            valueLabelDisplay="auto"
            valueLabelFormat={(index) => days[index] ?? ''}
            onChange={(_, value) => setDraftIndex(Array.isArray(value) ? value[0] : value)}
            onChangeCommitted={(_, value) => {
              const index = Array.isArray(value) ? value[0] : value;
              commitIndex(index);
            }}
            sx={{ flex: 1 }}
          />

          <IconButton
            size="small"
            aria-label="Kita diena"
            onClick={() => commitIndex(selectedIndex + 1)}
            disabled={selectedIndex >= days.length - 1}
            sx={STEP_BUTTON_SX}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}







// -----------------------------------------------------------
// GraphPage (default export)
// -----------------------------------------------------------
//
// Resolves the faucet address (the graph's root node), loads
// the used-day list (today is appended even before its first
// transaction — new claims appear live), holds the picked day
// and mounts the slider bar + graph. The selection is stored
// as the day STRING, so it survives the day list growing
// under it. CryptoFlowGraph rebuilds from scratch on a new
// window, the same way it does on a network switch.
//
// Used by:
//   - App.jsx — route /graph/:network
// -----------------------------------------------------------

export default function GraphPage() {

  const { network } = useParams();
  const [selectedDay, setSelectedDay] = useState(todayString);

  const { data, isPending, isError } = useQuery({
    queryKey: ['evm-faucet-balance', network],
    queryFn: async () => (await axios.get(`/api/evm/${network}/faucet-balance`)).data,
    staleTime: 60 * 1000,
  });
  const address = data?.address ?? null;

  // The root address's used days (+ per-day counts), bucketed
  // with the browser's UTC offset so backend days == local days
  const tzOffset = -new Date().getTimezoneOffset() * 60;
  const { data: daysData } = useQuery({
    queryKey: ['evm-tx-days', network, address],
    enabled: Boolean(address),
    queryFn: async () =>
      (await axios.get(
        `/api/evm/${network}/transaction-days?address=${address}&tz_offset=${tzOffset}`
      )).data,
    staleTime: 60 * 1000,
  });

  // Today is always offered, even before its first transaction
  const days = useMemo(() => {
    const known = (daysData?.days ?? []).map((entry) => entry.day);
    const today = todayString();
    return known.includes(today) ? known : [...known, today];
  }, [daysData]);


  // Live sweeps only make sense for today — a past day is
  // frozen history
  const range = useMemo(() => rangeOfDay(selectedDay), [selectedDay]);

  if (isPending) {
    return <div className="p-4 text-center">Kraunama…</div>;
  }

  if (isError) {
    return <div className="p-4 text-center text-red-600">Nepavyko gauti čiaupo adreso</div>;
  }

  if (!address) {
    return <div className="p-4 text-center">Adresas nerastas</div>;
  }

  return (
    // A fixed-height flex column matching the shell's viewport
    // budget (100dvh minus navbar + footer) — the bar takes its
    // natural height, the graph canvas absorbs the rest, and
    // the page never scrolls
    <div className="flex h-[calc(100dvh-105px)] flex-col p-4">
      <DateSliderBar days={days} selectedDay={selectedDay} onCommit={setSelectedDay} />

      <CryptoFlowGraph
        faucetAddress={address}
        network={network}
        dateRange={range}
        live={selectedDay === todayString()}
        day={selectedDay}
      />
    </div>
  );
}
