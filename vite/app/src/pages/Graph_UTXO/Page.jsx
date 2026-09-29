// -----------------------------------------------------------
//  [*] Pages — UTXO Transaction Graph (route /graph/utxo/:network)
//
//  The UTXO chains' transaction view: blocks as columns,
//  transactions as boxes with their inputs and outputs, each
//  output linked to the transaction that spent it. For now a
//  GUI MOCKUP drawn from hand-written sample data (see
//  hooks/useTransactionGraph.js) — no graph endpoint exists
//  yet. The network's display names still come from the
//  existing /api/utxo/networks catalog (cache shared with the
//  faucet page), so amounts read "tBTC4" on btc4.
//
//  On top, the title and — in the middle of the row — the day
//  slider over the days the data has blocks on, plus today;
//  the page opens on today, whose mempool is live. Under it,
//  the legend, then the graph of the picked day.
//
//  Reached from the UTXO faucet page's "Transakcijų grafikas"
//  button.
//
//  Split into (root component last):
//
//    LEGEND        — the key to the drawing's marks
//    Legend        — the key as one wrapped row
//    GraphUtxoPage — title row, legend and the graph
//                    (default export)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { COLORS } from './constants';
import { dayOf, useTransactionDays } from './hooks/useTransactionGraph';
import DateSliderBar from './components/DateSliderBar';
import UtxoFlowGraph from './components/UtxoFlowGraph';







// -----------------------------------------------------------
// LEGEND
// -----------------------------------------------------------
//
// What each mark on the graph means — the swatches draw the
// same colours, dashes and coin that TransactionBox and
// UtxoFlowGraph use, in a 28×14 viewBox the legend shrinks.
//
// Used by:
//   - Legend (below)
// -----------------------------------------------------------

const LEGEND = [
  {
    label: 'Čiaupo transakcija',
    swatch: <rect x="1" y="1" width="26" height="12" rx="3" fill={COLORS.BRAND} />,
  },
  {
    label: 'Kitos transakcijos',
    swatch: <rect x="1" y="1" width="26" height="12" rx="3" fill={COLORS.INK} />,
  },
  {
    label: 'Laukia patvirtinimo',
    swatch: <rect x="1.5" y="1.5" width="25" height="11" rx="3" fill="none" stroke={COLORS.COIN_EDGE} strokeWidth="1.5" strokeDasharray="4 3" />,
  },
  {
    label: '↩ Grąža',
    swatch: <line x1="1" y1="7" x2="27" y2="7" stroke={COLORS.MUTED} strokeWidth="2" strokeDasharray="5 3" />,
  },
  {
    label: 'Neišleista išvestis (UTXO)',
    swatch: <circle cx="14" cy="7" r="5.5" fill={COLORS.COIN} stroke={COLORS.COIN_EDGE} strokeWidth="1.5" />,
  },
];







// -----------------------------------------------------------
// Legend
// -----------------------------------------------------------
//
// Small print on purpose — a key to glance at, not a header —
// kept to the right edge, out of the title's way.
//
// Used by:
//   - GraphUtxoPage (below) — right above the graph
// -----------------------------------------------------------

function Legend() {
  return (
    <ul className="flex flex-wrap items-center justify-end gap-x-4 gap-y-0.5 text-xs text-gray-700">
      {LEGEND.map(({ label, swatch }) => (
        <li key={label} className="flex items-center gap-1.5">
          <svg width="20" height="10" viewBox="0 0 28 14" aria-hidden="true">{swatch}</svg>
          {label}
        </li>
      ))}
    </ul>
  );
}







// -----------------------------------------------------------
// GraphUtxoPage (default export)
// -----------------------------------------------------------
//
// Holds today and the picked day (as the day STRING, so it
// survives the day list growing under it), the network's
// names, and lays out the title row, the legend and the
// graph.
//
// Used by:
//   - App.jsx — route /graph/utxo/:network
// -----------------------------------------------------------

export default function GraphUtxoPage() {

  const { network } = useParams();
  const [today, setToday] = useState(() => dayOf(new Date()));
  const [selectedDay, setSelectedDay] = useState(today);
  const days = useTransactionDays(today);


  // Tick over at local midnight, like the EVM graph: the list
  // gains the new day, and a tab that was watching "today"
  // follows it instead of staying on yesterday
  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const id = setTimeout(() => {
      const next = dayOf(new Date());
      setSelectedDay((day) => (day === today ? next : day));
      setToday(next);
    }, midnight - Date.now() + 1000);
    return () => clearTimeout(id);
  }, [today]);


  // Display names only — the same catalog query (and cache)
  // as the UTXO faucet page
  const { data } = useQuery({
    queryKey: ['utxo-networks'],
    queryFn: async () => (await axios.get('/api/utxo/networks')).data,
    staleTime: 5 * 60 * 1000,
  });
  const info = data?.networks?.[network];


  return (
    // The shell hands the page the viewport's remaining height
    // as a flex column; the graph absorbs what the title row
    // and the legend leave
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">

      {/* Title on the left, the day slider in the middle — the
          empty third column keeps the slider centred on the
          page; on narrow screens the two stack */}
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_minmax(0,720px)_1fr]">
        <h1 className="text-xl font-bold text-[var(--color-primary)]">
          UTXO transakcijos — {info?.full_name ?? network}
        </h1>
        <DateSliderBar days={days} selectedDay={selectedDay} today={today} onCommit={setSelectedDay} />
      </div>

      <Legend />

      <UtxoFlowGraph day={selectedDay} today={today} unit={info?.short_name ?? 'BTC'} />
    </div>
  );
}
