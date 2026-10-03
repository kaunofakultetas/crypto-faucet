// -----------------------------------------------------------
//  [*] Pages — UTXO Transaction Graph (route /graph/utxo/:network)
//
//  The UTXO chains' transaction view: blocks as columns,
//  transactions as boxes with their inputs and outputs, each
//  output linked to the transaction that spent it — the
//  transactions around the faucet, as the backend crawls them
//  from the network's Electrum server (see
//  hooks/useTransactionGraph.js). The network's display names
//  come from the /api/utxo/networks catalog (cache shared with
//  the faucet page): the title carries the network's full
//  name, and every amount its own unit.
//
//  On top, the title and — in the middle of the row — the day
//  slider over the days the faucet has mined transactions on,
//  plus today; the page opens on today, whose mempool is live.
//  Under it, the legend, then the graph of the picked day.
//
//  A read the page could not do is said under the title row,
//  with why: without the day list the slider offers today
//  alone, and without the network list the title keeps the
//  network's key and amounts go without a unit — never with
//  one that may be another network's.
//
//  Reached from the UTXO faucet page's "Transakcijų grafikas"
//  button.
//
//  Split into (root component last):
//
//    LEGEND        — the key to the drawing's marks
//    Legend        — the key as one wrapped row
//    FailedReads   — why the day list or the network list is
//                    missing
//    GraphUtxoPage — title row, legend and the graph
//                    (default export)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { MalformedAnswerError, requestErrorText, withNextStep } from '@/utils/requestError';

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
    label: 'Neišleista išvestis (UTXO)',
    swatch: <circle cx="14" cy="7" r="5.5" fill={COLORS.COIN} stroke={COLORS.COIN_EDGE} strokeWidth="1.5" />,
  },
  {
    label: 'Nežinoma, ar išleista',
    swatch: <circle cx="14" cy="7" r="5" fill="#ffffff" stroke={COLORS.MUTED} strokeWidth="1.5" strokeDasharray="2 2" />,
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
// FailedReads
// -----------------------------------------------------------
//
// The page's own reads that never succeeded, each a short red
// line: the sentence saying what failed and why, then what
// the page shows instead — the slider offers today alone
// without the day list; without the network list the amounts
// go without a currency code rather than borrow one that may
// be wrong. Nothing while both reads are fine. Plain lines,
// not an alert: the drawing still works, and the canvas has a
// status of its own.
//
// Used by:
//   - GraphUtxoPage (below) — between the title row and the
//     legend
// -----------------------------------------------------------

function FailedReads({ daysError, catalogError }) {

  const lines = [
    daysError && withNextStep(daysError, 'Pasirinkti galima tik šiandieną.'),
    catalogError && withNextStep(catalogError, 'Sumos rodomos be valiutos kodo.'),
  ].filter(Boolean);


  if (!lines.length) {
    return null;
  }

  return (
    <div className="text-sm text-red-700">
      {lines.map((line) => <p key={line}>{line}</p>)}
    </div>
  );
}







// -----------------------------------------------------------
// GraphUtxoPage (default export)
// -----------------------------------------------------------
//
// Holds today and the picked day (as the day STRING, so it
// survives the day list growing under it), the day list, the
// network's names, and lays out the title row, the lines on
// the reads that failed, the legend and the graph.
//
// Used by:
//   - App.jsx — route /graph/utxo/:network
// -----------------------------------------------------------

export default function GraphUtxoPage() {

  const { network } = useParams();
  const [today, setToday] = useState(() => dayOf(new Date()));
  const [selectedDay, setSelectedDay] = useState(today);
  const { days, error: daysError } = useTransactionDays(network, today);


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
  // as the UTXO faucet page, under the same rule: an answer
  // without a networks map is a failed read, never a list that
  // knows nothing. A read that never succeeded is said (a
  // failed refresh keeps the list it had); only text counts as
  // a name or a unit, and no unit is better than a guess
  const { data, isError, error } = useQuery({
    queryKey: ['utxo-networks'],
    queryFn: async () => {
      const list = (await axios.get('/api/utxo/networks')).data;
      const map = list?.networks;
      if (!map || typeof map !== 'object' || Array.isArray(map)) throw new MalformedAnswerError();
      return list;
    },
    staleTime: 5 * 60 * 1000,
  });
  const info = data?.networks?.[network];
  const fullName = typeof info?.full_name === 'string' && info.full_name ? info.full_name : network;
  const unit = typeof info?.short_name === 'string' && info.short_name ? info.short_name : null;
  const catalogError = isError && !data ? requestErrorText(error, 'Nepavyko gauti tinklų sąrašo.') : null;


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
          Transakcijų Srautas - {fullName}
        </h1>
        <DateSliderBar days={days} selectedDay={selectedDay} today={today} onCommit={setSelectedDay} />
      </div>

      <FailedReads daysError={daysError} catalogError={catalogError} />

      <Legend />

      <UtxoFlowGraph network={network} day={selectedDay} today={today} unit={unit} />
    </div>
  );
}
