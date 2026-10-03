// -----------------------------------------------------------
//  [*] Pages — EVM Faucet (route /faucet/evm/:network)
//
//  The student-facing faucet for NATIVE EVM coins (Sepolia
//  ETH and friends). ERC-20 tokens live on their own page,
//  keyed by TOKEN rather than by network: /faucet/erc20/:token.
//
//  The four-step MetaMask flow (install → connect → switch
//  network → claim) is driven by the shared useMetamaskWallet
//  hook; claiming signs a nonce message the backend verifies
//  before sending (GET /api/evm/<network>/request), and a
//  payout is announced with its transaction id, linked to the
//  transaction on the network's block explorer. The faucet's
//  return address renders as text + QR, with a shortcut to
//  the transaction graph (/graph/<network>).
//
//  Network metadata (chain id, names, RPC urls, explorer)
//  comes from /api/evm/networks and also feeds MetaMask's
//  wallet_addEthereumChain when the chain is missing there.
//  The page shows skeletons until both the metadata and the
//  faucet info have arrived, and nothing it reads can keep
//  them up forever: a catalog that failed or came back in a
//  shape the page cannot use, or a :network the catalog does
//  not know, gets an error card; faucet info that failed or
//  came back malformed is said in the card where its numbers
//  would stand, while the poll keeps trying. Each failure says
//  what went wrong — the backend's own sentence when it gave
//  one, otherwise the page's with the reason after it.
//
//  Split into (root component last):
//
//    FAUCET_REFRESH_MS — faucet balance repoll cadence
//    CLAIM_FAILED      — the claim's own failure sentence
//    NETWORKS_FAILED   — the network list's failure sentence
//    FAUCET_FAILED     — the faucet info's failure sentence
//    WALLET_FAILED     — the student's balance's failure sentence
//    isPlainObject     — the shape checks' building block
//    isCatalog         — a usable /api/evm/networks answer
//    isFaucetInfo      — a usable faucet-balance answer
//    useFaucetInfo     — network metadata + faucet polling
//    LoadingSkeleton   — full-page skeleton layout
//    FaucetRows        — the faucet's numbers, or its failure
//    ReturnAddressCard — return address, QR, graph shortcut
//    FaucetEVM         — page state + layout (default export)
// -----------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-qr-code';
import axios from 'axios';

import { Alert, Button, Box, Skeleton, Stack, CircularProgress } from '@mui/material';
import HubIcon from '@mui/icons-material/Hub';

import useMetamaskWallet from '@/hooks/useMetamaskWallet';
import { WalletStepper, WalletGateButton, FadingAlert, useAlerts } from '@/components/WalletFlow';
import AssetIcon from '@/components/AssetIcon';
import ErrorCard from '@/components/ErrorCard';
import PayoutMessage from '@/components/PayoutMessage';
import FailureNote from '@/components/FailureNote';
import { MalformedAnswerError, requestErrorText, withNextStep } from '@/utils/requestError';
import { payoutTxid } from '@/utils/payout';


// How often the faucet balance repolls
const FAUCET_REFRESH_MS = 3000;

// What a failed claim says when neither the backend nor the
// wallet gave a reason of their own
const CLAIM_FAILED = 'Nepavyko išsiųsti kriptovaliutos.';

// What a failed read of the network list says when the
// backend gave no sentence of its own
const NETWORKS_FAILED = 'Nepavyko gauti tinklų sąrašo.';

// The same for a failed read of the faucet's info
const FAUCET_FAILED = 'Nepavyko gauti čiaupo informacijos.';

// What the student's balance row says under its dash when
// MetaMask could not read the balance
const WALLET_FAILED = 'Nepavyko gauti jūsų MetaMask balanso.';







// -----------------------------------------------------------
// isPlainObject
// -----------------------------------------------------------
//
// A JSON object in the everyday sense — not null, not a list,
// not a string or a number — the one container the backend's
// answers are built from.
//
// Used by:
//   - isCatalog, isFaucetInfo (below)
// -----------------------------------------------------------

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);







// -----------------------------------------------------------
// isCatalog
// -----------------------------------------------------------
//
// Whether an /api/evm/networks answer can drive the page: an
// object whose networks map holds an entry per network.
// Anything else — a proxy's empty body, a list, the map
// missing — used to leave the page waiting for networks that
// would never come.
//
// Used by:
//   - useFaucetInfo (below) — the query and its cache reads
// -----------------------------------------------------------

const isCatalog = (body) => isPlainObject(body) && isPlainObject(body.networks);







// -----------------------------------------------------------
// isFaucetInfo
// -----------------------------------------------------------
//
// Whether a faucet-balance answer is what the page renders:
// the faucet's address as text (the return address and its
// QR code are made from it), the balance and the per-claim
// amount as numbers. An answer of any other shape is a failed
// read rather than something to render — a missing address
// used to crash the whole page.
//
// Used by:
//   - useFaucetInfo (below) — the query and its cache reads
// -----------------------------------------------------------

const isFaucetInfo = (body) => isPlainObject(body)
  && typeof body.address === 'string' && body.address !== ''
  && Number.isFinite(body.balance)
  && Number.isFinite(body.chunk_size);







// -----------------------------------------------------------
// useFaucetInfo
// -----------------------------------------------------------
//
// The backend side of the page as two TanStack queries: the
// network's metadata (chain id, names, RPC urls, explorer —
// from /api/evm/networks, cache shared with the graph page;
// the navbar reads the bundled /api/faucet/catalog instead)
// and the faucet's address, balance and per-claim amount,
// polling every 3 s once the metadata is in. A network switch
// changes the query keys, so the previous chain's numbers
// never linger.
//
// Both answers are checked for the shape the page needs
// inside their queries, so a malformed body fails the query
// just like an error status does. The checks run again on the
// way out, because the graph page fills the same cache
// entries without them. The page learns which case it is in:
// the catalog never arrived or is unusable (catalogFailed),
// the catalog does not know this :network (unknownNetwork),
// or the faucet info never arrived (faucetFailed — the poll
// keeps trying, and a later answer clears it) — each failure
// with the error behind it, for the page to say what went
// wrong. A failed repoll keeps the last good numbers on
// screen.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function useFaucetInfo(network) {

  const { data: catalog, error: catalogQueryError } = useQuery({
    queryKey: ['evm-networks'],
    queryFn: async () => {
      const body = (await axios.get('/api/evm/networks')).data;
      if (!isCatalog(body)) throw new MalformedAnswerError();
      return body;
    },
    staleTime: 5 * 60 * 1000,
  });
  const networks = isCatalog(catalog) ? catalog.networks : null;
  // Own keys only — a :network named after a property every
  // object inherits is not a network the catalog knows
  const networkInfo = networks && Object.hasOwn(networks, network) ? networks[network] : null;
  // An unusable answer the graph page cached counts as a
  // failure too, not as a load still on its way — one in an
  // unusable shape
  const catalogFailed = !networks && Boolean(catalogQueryError || catalog !== undefined);
  const catalogError = catalogFailed ? (catalogQueryError ?? new MalformedAnswerError()) : null;
  const unknownNetwork = Boolean(networks) && !networkInfo;


  const faucetQuery = useQuery({
    queryKey: ['evm-faucet-balance', network],
    queryFn: async () => {
      const body = (await axios.get(`/api/evm/${network}/faucet-balance`)).data;
      if (!isFaucetInfo(body)) throw new MalformedAnswerError();
      return body;
    },
    enabled: Boolean(networkInfo),
    refetchInterval: FAUCET_REFRESH_MS,
  });
  const faucetInfo = isFaucetInfo(faucetQuery.data) ? faucetQuery.data : null;
  const faucetFailed = !faucetInfo && faucetQuery.isError;

  return {
    networkInfo, faucetInfo, faucetFailed, faucetError: faucetQuery.error,
    catalogFailed, catalogError, unknownNetwork,
  };
}







// -----------------------------------------------------------
// LoadingSkeleton
// -----------------------------------------------------------
//
// The whole page as grey bones — same four cards, shown until
// both the network metadata and the faucet info have arrived,
// or the faucet info has failed.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function LoadingSkeleton() {
  return (
    <Box className="p-4" aria-busy="true">
      <p role="status" className="sr-only">Kraunami tinklo duomenys…</p>
      <div className="mx-auto w-full min-w-[320px] max-w-[640px] px-4 pt-4">
        <Skeleton variant="text" height={48} width="70%" />
        <Skeleton variant="text" height={20} width="90%" />
      </div>

      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
        <Skeleton variant="rectangular" height={60} />
      </div>

      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
        <Stack spacing={2}>
          <Skeleton variant="text" height={28} />
          <Skeleton variant="text" height={28} />
          <Skeleton variant="text" height={28} />
          <Skeleton variant="rectangular" height={40} />
        </Stack>
      </div>

      <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[640px] p-4">
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" height={24} width="50%" />
            <Skeleton variant="text" height={20} width="80%" />
          </Box>
          <Skeleton variant="rectangular" height={128} width={128} />
        </Stack>
      </div>
    </Box>
  );
}







// -----------------------------------------------------------
// FaucetRows
// -----------------------------------------------------------
//
// The faucet's two numbers in the main card — what one claim
// pays out and what the faucet still holds — or, when the
// faucet info never arrived, the sentence saying what went
// wrong in their place. A backend that cannot answer used to
// leave the skeleton up forever.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function FaucetRows({ faucetInfo, failure, shortName }) {

  if (!faucetInfo) {
    return <Alert severity="error" sx={{ my: 1 }}>{failure}</Alert>;
  }

  return (
    <>
      <div className="my-2 flex">
        <span className="flex-1">Išsiųsime jums:</span>
        <span className="text-right">{faucetInfo.chunk_size.toFixed(3)} {shortName}</span>
      </div>
      <div className="my-2 flex">
        <span className="flex-1">Čiaupo balansas:</span>
        <span className="text-right">{faucetInfo.balance.toFixed(3)} {shortName}</span>
      </div>
    </>
  );
}







// -----------------------------------------------------------
// ReturnAddressCard
// -----------------------------------------------------------
//
// The bottom card: the faucet's own address, lower-cased, as
// text and QR code so leftover coins can be sent back, with
// the shortcut into the network's transaction graph. The
// graph needs an explorer behind it — a chain without one
// gets no button rather than an empty graph. Shown only once
// the faucet's address is known.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function ReturnAddressCard({ address, shortName, showGraph, onOpenGraph }) {

  const faucetAddress = address.toLowerCase();

  return (
    <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[640px] p-4">
      <div className="my-2 flex items-start gap-4">
        <span className="flex-1">
          Grąžinkite nebereikalingą <u><b>{shortName}</b></u> krypto atgal:
          <br /><br />{faucetAddress}
          {showGraph && (
            <>
              <br /><br />
              <Button
                variant="contained"
                onClick={onOpenGraph}
                startIcon={<HubIcon />}
                sx={{ padding: '10px 16px' }}
              >
                Transakcijų srautas
              </Button>
            </>
          )}
        </span>
        <QRCode value={faucetAddress} size={128} />
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// FaucetEVM (default export)
// -----------------------------------------------------------
//
// The page itself: wires the wallet and faucet hooks into the
// stepper, the balance rows, the claim button and the alerts.
// The claim waits while the faucet's own info never arrived —
// the card says why — and every outcome belongs to the
// network it was claimed on.
//
// Used by:
//   - App.jsx — route /faucet/evm/:network
// -----------------------------------------------------------

export default function FaucetEVM() {

  const { network } = useParams();
  const navigate = useNavigate();

  const {
    networkInfo, faucetInfo, faucetFailed, faucetError, catalogFailed, catalogError, unknownNetwork,
  } = useFaucetInfo(network);
  const wallet = useMetamaskWallet(networkInfo?.chain_id);
  const { alerts, addAlert, clearAlerts } = useAlerts();
  const queryClient = useQueryClient();

  // Which network a claim is in flight FOR — a switch in the
  // picker keeps this component mounted, so a plain boolean
  // would lock the new chain's button behind the old chain's
  // request, and a late answer would land on the wrong page
  const [claimingFor, setClaimingFor] = useState(null);
  const claiming = claimingFor === network;
  const networkRef = useRef(network);


  // A network switch drops the outcome rows — they talk about
  // the previous chain — and notes the switch for any request
  // still in flight
  useEffect(() => {
    networkRef.current = network;
    clearAlerts();
  }, [network, clearAlerts]);


  // Sign the ownership message and let the backend verify it
  // before paying out — no transaction on the student's side.
  // A successful claim invalidates the balance query, so the
  // faucet's number drops immediately instead of on the next
  // poll, and is announced with its transaction. A 200 that
  // names no transaction paid nothing out, so it is reported
  // as a failed claim. An answer that arrives after a network
  // switch is dropped: it belongs to the chain it was issued
  // for.
  const claimNative = async () => {
    const forNetwork = network;
    setClaimingFor(forNetwork);
    try {
      const { nonce, signature } = await wallet.signMessage();

      const { data: payout } = await axios.get(`/api/evm/${forNetwork}/request`, {
        params: { address: wallet.account, signature, nonce },
      });
      const txHash = payoutTxid(payout, 'transaction_hash', CLAIM_FAILED);

      queryClient.invalidateQueries({ queryKey: ['evm-faucet-balance', forNetwork] });
      if (networkRef.current !== forNetwork) return;
      addAlert('success', (
        <PayoutMessage
          sentence={`${networkInfo.full_name} išsiųstas į jūsų piniginę.`}
          txid={txHash}
          explorer={networkInfo.block_explorer_urls?.[0]}
        />
      ));
    } catch (e) {
      // The backend's refusals are shown word for word, a
      // wallet's refusal in the wallet's words, anything else
      // as the page's own sentence with the reason after it
      if (networkRef.current !== forNetwork) return;
      addAlert('error', requestErrorText(e, CLAIM_FAILED));
    } finally {
      setClaimingFor((current) => (current === forNetwork ? null : current));
    }
  };


  if (catalogFailed) {
    return <ErrorCard>{withNextStep(requestErrorText(catalogError, NETWORKS_FAILED), 'Perkraukite puslapį.')}</ErrorCard>;
  }

  if (unknownNetwork) {
    return <ErrorCard>Nežinomas tinklas: {network}</ErrorCard>;
  }

  if (!networkInfo || (!faucetInfo && !faucetFailed)) {
    return <LoadingSkeleton />;
  }

  // Three states that must not blur: no wallet or a dead RPC
  // is a dash, a poll still in flight is "Kraunama…". The
  // balance is a BigInt of wei — divided down to micro-ether
  // as an integer first, so the float never sees 18 digits.
  const formatBalance = (wei) => {
    if (!wallet.installed || wallet.balanceFailed) return '-';
    if (wei == null) return 'Kraunama…';
    const microEther = Number(wei / 1_000_000_000_000n);
    return `${(microEther / 1e6).toFixed(3)} ${networkInfo.short_name}`;
  };

  // Nothing to claim from a faucet whose info never arrived —
  // the button stays, greyed like a claim in flight
  const claimBlocked = claiming || !faucetInfo;


  return (
    <Box className="p-4">

      {/* Title */}
      <div className="mx-auto w-full min-w-[320px] max-w-[640px] px-4 pt-4">
        <h1 className="mb-3 text-center text-[45px] font-bold text-[#78003F]">
          <AssetIcon assetKey={network} icon={networkInfo.icon} size={40} inline />
          {networkInfo.full_name} faucet&apos;as
        </h1>
        <p className="text-sm text-gray-700">
          Šiuo įrankiu galite gauti <u>{networkInfo.full_name}</u> testinės kriptovaliutos laboratoriniams darbams.
        </p>
      </div>

      {/* The four-step MetaMask flow */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
        <WalletStepper
          activeStep={wallet.step}
          steps={[
            'Susidiegti MetaMask',
            'Prijungti MetaMask',
            `Įsijungti ${networkInfo.full_name} tinklą`,
            `Atsisiųsti ${networkInfo.full_name}`,
          ]}
        />
      </div>

      {/* Balances, the claim button and its outcome alerts */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">

        <div className="my-2 flex">
          <span className="flex-1">Jūsų MetaMask balansas:</span>
          <span className="text-right">{wallet.step === 3 ? formatBalance(wallet.balance) : 'Piniginė neprijungta'}</span>
        </div>
        {wallet.step === 3 && wallet.balanceFailed && (
          <FailureNote>{requestErrorText(wallet.balanceError, WALLET_FAILED)}</FailureNote>
        )}
        <FaucetRows
          faucetInfo={faucetInfo}
          failure={requestErrorText(faucetError, FAUCET_FAILED)}
          shortName={networkInfo.short_name}
        />

        <div className="mt-3">
          <WalletGateButton
            step={wallet.step}
            networkInfo={networkInfo}
            onConnect={wallet.connect}
            onSwitch={wallet.switchNetwork}
            onError={(msg) => addAlert('error', msg)}
          />

          {wallet.step === 3 && (
            <Button
              variant="contained"
              color="primary"
              fullWidth
              aria-busy={claiming}
              aria-disabled={claimBlocked}
              onClick={claimBlocked ? undefined : claimNative}
              sx={{ minHeight: 40, '&[aria-disabled="true"]': { opacity: 0.6, pointerEvents: 'none' } }}
            >
              {claiming && <CircularProgress size={22} color="inherit" aria-hidden="true" sx={{ mr: 1 }} />}
              {claiming ? 'Siunčiama…' : `Gauti ${networkInfo.full_name} valiutos`}
            </Button>
          )}
        </div>

        {alerts.map((a) => (
          <FadingAlert key={a.id} severity={a.severity} onDone={a.dismiss}>
            {a.message}
          </FadingAlert>
        ))}
      </div>

      {/* Return address + the transaction graph shortcut, once
          the faucet's address is known */}
      {faucetInfo && (
        <ReturnAddressCard
          address={faucetInfo.address}
          shortName={networkInfo.short_name}
          showGraph={networkInfo.has_explorer !== false}
          onOpenGraph={() => navigate(`/graph/${network}`)}
        />
      )}

    </Box>
  );
}
