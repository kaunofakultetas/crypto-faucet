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

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import QRCode from 'react-qr-code';

import { Box, Paper, TextField, Button, Alert, Stack, Typography, Divider, Skeleton } from '@mui/material';


// How often the faucet balance repolls in the background
const BALANCE_REFRESH_MS = 5000;

// Shown until /api/utxo/networks answers (and kept if it
// fails) — the page stays usable with generic BTC labels
const DEFAULT_NET_META = { short_name: 'BTC', full_name: 'Bitcoin' };







// -----------------------------------------------------------
// useFaucetInfo
// -----------------------------------------------------------
//
//   const { netMeta, faucetInfo, loadingInfo, initialLoad,
//           refresh } = useFaucetInfo(network)
//
// Everything the page knows about the faucet: the network's
// display names and the live faucet info ({ balance, address,
// chunk_size } or { error }), repolled silently every 5 s.
// initialLoad separates the first fetch (skeletons) from the
// background repolls (no flicker). A request sequence number
// discards late responses after a network switch or unmount,
// so a slow answer from the previous chain can never
// overwrite the current one.
//
// Used by:
//   - FaucetUTXO (below)
// -----------------------------------------------------------

function useFaucetInfo(network) {

  const [netMeta, setNetMeta] = useState(DEFAULT_NET_META);
  const [faucetInfo, setFaucetInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);

  // Bumped on every fetch and on cleanup — only the response
  // matching the newest sequence number may write state
  const requestSeqRef = useRef(0);


  // silent = a background repoll: the data updates but the
  // loading flag stays down, so nothing flickers
  const loadFaucetInfo = async (silent = false) => {
    const seq = ++requestSeqRef.current;

    try {
      if (!silent) setLoadingInfo(true);
      const { data } = await axios.get(`/api/utxo/${network}/faucet-balance`);
      if (seq === requestSeqRef.current) setFaucetInfo(data);
    } catch (_) {
      if (seq === requestSeqRef.current) {
        setFaucetInfo({ error: 'Nepavyko gauti čiaupo informacijos' });
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setLoadingInfo(false);
        setInitialLoad(false);
      }
    }
  };


  // Display names once per network; failures keep the defaults
  useEffect(() => {
    let ignore = false;

    const loadMeta = async () => {
      try {
        const { data } = await axios.get('/api/utxo/networks');
        const info = data?.networks?.[network];
        if (!ignore && info) {
          setNetMeta({ short_name: info.short_name || 'BTC', full_name: info.full_name || 'Bitcoin' });
        }
      } catch (_) {
        /* keep defaults */
      }
    };

    loadMeta();
    return () => { ignore = true; };
  }, [network]);


  // Reset, first load and the 5 s repoll — all per network
  useEffect(() => {
    setFaucetInfo(null);
    setLoadingInfo(true);
    setInitialLoad(true);

    loadFaucetInfo(false);
    const id = setInterval(() => loadFaucetInfo(true), BALANCE_REFRESH_MS);

    return () => {
      clearInterval(id);
      requestSeqRef.current++;
    };
  }, [network]);


  return { netMeta, faucetInfo, loadingInfo, initialLoad, refresh: loadFaucetInfo };
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
      <Paper elevation={0} className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[560px] p-4">
        <Skeleton variant="text" height={30} width="60%" />
        <Skeleton variant="text" height={20} sx={{ mt: 1.5 }} />
      </Paper>
    );
  }

  if (initialLoad || !faucetInfo || faucetInfo.error) {
    return null;
  }

  return (
    <Paper elevation={0} className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[560px] p-4">
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

      {/* Title */}
      <Box className="mx-auto w-full min-w-[320px] max-w-[560px] px-4 pt-4">
        <Typography variant="h3" sx={{ fontWeight: 800, color: '#78003F', mb: 1.5, fontSize: 36 }}>
          {currencyFull} faucet&apos;as
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Šiuo įrankiu galite gauti <u>{currencyFull}</u> testinės kriptovaliutos laboratoriniams darbams.
        </Typography>
      </Box>

      {/* Main card — the numbers, outcome alerts and the form */}
      <Paper elevation={0} className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4">
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
