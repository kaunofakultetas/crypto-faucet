// -----------------------------------------------------------
//  [*] Pages — UTXO Faucet (route /faucet/utxo/:network)
//
//  The student-facing faucet for UTXO chains (Bitcoin and
//  friends, testnets): shows what the faucet will send and its
//  live balance, takes an address and requests coins via
//  GET /api/utxo/<network>/request-btc, and shows the faucet's
//  own address (text + QR) so leftover coins can be returned.
//
//  The balance repolls silently every 5 s; the network's
//  display names come from /api/utxo/networks (BTC/Bitcoin
//  defaults cover the fetch window). All UI text is
//  Lithuanian.
//
//  Split into (root component last):
//
//    BALANCE_REFRESH_MS — background repoll cadence
//    DEFAULT_NET_META   — BTC fallback until the names load
//    useFaucetInfo      — names + faucet info + polling
//    BalanceRows        — "we'll send" + balance lines
//    ReturnAddressCard  — return address + QR (or skeleton)
//    FaucetUTXO         — form state + request (default
//                         export)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import QRCode from 'react-qr-code';

import { Box, Paper, TextField, Button, Alert, Stack, Typography, Divider, Skeleton } from '@mui/material';

import AssetIcon from '@/components/AssetIcon';


// How often the faucet balance repolls in the background
const BALANCE_REFRESH_MS = 5000;

// Shown until /api/utxo/networks answers (and kept if it
// fails) — the page stays usable with generic BTC labels
const DEFAULT_NET_META = { short_name: 'BTC', full_name: 'Bitcoin', icon: null };







// -----------------------------------------------------------
// useFaucetInfo
// -----------------------------------------------------------
//
//   const { netMeta, faucetInfo, loadingInfo, initialLoad,
//           refresh } = useFaucetInfo(network)
//
// Everything the page knows about the faucet, as two TanStack
// queries: the network's display names (cache shared with the
// navbar's UTXO catalog) and the live faucet info
// ({ balance, address, chunk_size } or { error }), repolled
// silently every 5 s. initialLoad separates the first fetch
// (skeletons) from the background repolls (no flicker); a
// network switch changes the query key, so a slow answer from
// the previous chain can never overwrite the current one.
// refresh() (after a payout) invalidates the balance for an
// immediate refetch.
//
// Used by:
//   - FaucetUTXO (below)
// -----------------------------------------------------------

function useFaucetInfo(network) {

  const queryClient = useQueryClient();

  // Display names; failures keep the BTC defaults
  const { data: networksData } = useQuery({
    queryKey: ['utxo-networks'],
    queryFn: async () => (await axios.get('/api/utxo/networks')).data,
    staleTime: 5 * 60 * 1000,
  });
  const info = networksData?.networks?.[network];
  const netMeta = info
    ? { short_name: info.short_name || 'BTC', full_name: info.full_name || 'Bitcoin', icon: info.icon ?? null }
    : DEFAULT_NET_META;

  const balanceQuery = useQuery({
    queryKey: ['utxo-faucet-balance', network],
    queryFn: async () => (await axios.get(`/api/utxo/${network}/faucet-balance`)).data,
    refetchInterval: BALANCE_REFRESH_MS,
  });

  // The exact shape the page always consumed: a failed fetch
  // becomes an { error } payload the render branches on
  const faucetInfo = balanceQuery.isError
    ? { error: 'Nepavyko gauti čiaupo informacijos' }
    : (balanceQuery.data ?? null);

  return {
    netMeta,
    faucetInfo,
    loadingInfo: balanceQuery.isFetching,
    initialLoad: balanceQuery.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['utxo-faucet-balance', network] }),
  };
}







// -----------------------------------------------------------
// BalanceRows
// -----------------------------------------------------------
//
// The two numbers of the main card: what one request pays out
// (chunk_size) and what the faucet currently holds.
//
// Used by:
//   - FaucetUTXO (below) — inside the main card
// -----------------------------------------------------------

function BalanceRows({ faucetInfo, currencyShort }) {
  return (
    <>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography sx={{ flex: 1 }}>Išsiųsime jums:</Typography>
        <Typography>{Number(faucetInfo.chunk_size || 0).toFixed(3)} {currencyShort}</Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography sx={{ flex: 1 }}>Čiaupo balansas:</Typography>
        <Typography>{Number(faucetInfo.balance || 0).toFixed(3)} {currencyShort}</Typography>
      </Box>
    </>
  );
}







// -----------------------------------------------------------
// ReturnAddressCard
// -----------------------------------------------------------
//
// The bottom card: the faucet's own address as text + QR so
// students can send leftover coins back. Skeleton during the
// first load, nothing at all when the faucet info failed.
//
// Used by:
//   - FaucetUTXO (below)
// -----------------------------------------------------------

function ReturnAddressCard({ initialLoad, loadingInfo, faucetInfo, currencyShort }) {

  if (initialLoad && loadingInfo) {
    return (
      <Paper elevation={0} className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[640px] p-4">
        <Skeleton variant="text" height={30} width="60%" />
        <Skeleton variant="text" height={20} sx={{ mt: 1.5 }} />
      </Paper>
    );
  }

  if (initialLoad || !faucetInfo || faucetInfo.error) {
    return null;
  }

  return (
    <Paper elevation={0} className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[640px] p-4">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography>
            Grąžinkite nebereikalingą <b>{currencyShort}</b> atgal:
          </Typography>
          <Typography sx={{ mt: 1.5, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.875rem' }}>
            {faucetInfo.address}
          </Typography>
        </Box>
        {faucetInfo.address && (
          <QRCode value={faucetInfo.address} size={128} />
        )}
      </Box>
    </Paper>
  );
}







// -----------------------------------------------------------
// FaucetUTXO (default export)
// -----------------------------------------------------------
//
// The page itself: the request form state and the send call.
// Faucet data and polling live in useFaucetInfo.
//
// Used by:
//   - main.jsx — route /faucet/utxo/:network (imported as
//     FaucetUTXO)
// -----------------------------------------------------------

export default function FaucetUTXO() {

  const { network } = useParams();
  const { netMeta, faucetInfo, loadingInfo, initialLoad, refresh } = useFaucetInfo(network);

  const [recipient, setRecipient] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null); // { txid, amount }
  const [error, setError] = useState(null);

  const currencyShort = netMeta.short_name;
  const currencyFull = netMeta.full_name;


  // A network switch keeps the typed address but drops the old
  // outcome messages — they talk about the previous chain
  useEffect(() => {
    setSuccess(null);
    setError(null);
  }, [network]);


  // Ask the faucet to send coins. Backend errors arrive both
  // as { error } payloads with HTTP 200 and as 4xx/5xx with
  // { error, details } — every shape ends in the red alert.
  const handleRequest = async () => {
    setSuccess(null);
    setError(null);

    try {
      setSubmitting(true);
      const { data } = await axios.get(`/api/utxo/${network}/request-btc`, { params: { address: recipient.trim() } });
      if (data?.error) {
        setError(data.error);
      } else {
        setSuccess({ txid: data.transaction_id, amount: data.amount });
        setRecipient('');
        refresh(); // the balance just changed
      }
    } catch (e) {
      if (e.response?.data?.error) {
        const details = e.response.data.details;
        setError(details ? `${e.response.data.error}\n\nDetalės: ${details}` : e.response.data.error);
      } else if (e.response?.status === 429) {
        setError('Per daug užklausų. Palaukite ir bandykite vėl.');
      } else if (e.response?.status >= 400) {
        setError(`Serverio klaida (${e.response.status}): ${e.response.data?.error || 'Nežinoma klaida'}`);
      } else {
        setError('Nepavyko išsiųsti kriptovaliutos. Patikrinkite interneto ryšį.');
      }
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <Box className="p-4">

      {/* Title — same markup as the EVM and ERC-20 pages, so
          the top gap and title size match across all three */}
      <Box className="mx-auto w-full min-w-[320px] max-w-[640px] px-4 pt-4">
        <h1 className="mb-3 text-center text-[45px] font-bold text-[#78003F]">
          <AssetIcon assetKey={network} icon={netMeta.icon} size={40} inline />
          {currencyFull} faucet&apos;as
        </h1>
        <p className="text-sm text-gray-700">
          Šiuo įrankiu galite gauti <u>{currencyFull}</u> testinės kriptovaliutos laboratoriniams darbams.
        </p>
      </Box>

      {/* Main card — the numbers, outcome alerts and the form */}
      <Paper elevation={0} className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
        <Stack spacing={2}>

          {initialLoad && loadingInfo ? (
            <Stack spacing={2}>
              <Skeleton variant="text" height={40} />
              <Skeleton variant="text" height={40} />
            </Stack>
          ) : faucetInfo?.error ? (
            <Alert severity="error">{faucetInfo.error}</Alert>
          ) : faucetInfo ? (
            <BalanceRows faucetInfo={faucetInfo} currencyShort={currencyShort} />
          ) : null}

          {success && (
            <Alert severity="success">
              Išsiųsta {success.amount} {currencyShort}. Transakcija: {success.txid}
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
              {error}
            </Alert>
          )}

          <Divider />

          <TextField
            label={`Jūsų ${currencyShort} adresas`}
            placeholder="pvz. tb1q…"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            fullWidth
          />

          <Button
            variant="contained"
            onClick={handleRequest}
            disabled={
              submitting ||
              (initialLoad && loadingInfo) ||
              !!faucetInfo?.error ||
              recipient.trim().length === 0
            }
            sx={{ minHeight: 42, position: 'relative' }}
          >
            {recipient.trim().length === 0
              ? 'ĮKLIJUOKITE ADRESĄ'
              : (submitting ? 'Siunčiama…' : `Gauti ${currencyShort}`)}
          </Button>

        </Stack>
      </Paper>

      <ReturnAddressCard
        initialLoad={initialLoad}
        loadingInfo={loadingInfo}
        faucetInfo={faucetInfo}
        currencyShort={currencyShort}
      />

    </Box>
  );
}
