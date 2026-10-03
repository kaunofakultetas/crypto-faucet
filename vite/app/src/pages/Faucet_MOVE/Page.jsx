// -----------------------------------------------------------
//  [*] Pages — MOVE Faucet (route /faucet/move/:network)
//
//  The student-facing faucet for Move chains (Sui Testnet).
//  Laid out like the SVM page — title, stepper, balances,
//  claim, return address — but the flow is one step SHORTER:
//  Sui wallets are chain-scoped, so there is no network step
//  at all (install → connect → claim). The wallet itself is
//  whatever Sui-capable extension the student has (Slush,
//  Suiet, …) — useSuiWallet discovers it via the Wallet
//  Standard and the page shows its real name.
//
//  Claiming signs a nonce the backend verifies before sending
//  (GET /api/move/<network>/request); the success alert names
//  the payout's transaction, linked to the network's
//  explorer. The student's own balance is read straight from
//  the network's public GraphQL endpoint (from the catalog
//  payload). The faucet's return address renders as text +
//  QR — hex is case-insensitive, but it is kept as the
//  backend prints it.
//
//  One thing the wallet will not do for the student: a Sui
//  address is the same on every network, but the wallet UI
//  has a network selector (shipped on Mainnet), and the
//  faucet pays on the network in the URL — so the page keeps
//  a note on screen naming the network to select, amber when
//  the wallet says it is on another one.
//
//  No answer of the backend leaves the page hanging: a network
//  list without its map gets the list's failure card, faucet
//  info that never arrived (or arrived in another shape) a
//  failure notice on a page whose wallet steps still work, and
//  a failed claim a Lithuanian sentence. Each one says what
//  went wrong — the backend's own sentence when it gave one,
//  otherwise the page's with the reason after it.
//
//  Split into (root component last):
//
//    MOVE_REFRESH_MS   — balance repoll cadence
//    NETWORK_LABELS    — flavour key → the wallet's label
//    CLAIM_FAILED      — the claim's own failure sentence
//    NETWORKS_FAILED   — the network list's failure sentence
//    FAUCET_FAILED     — the faucet info's failure sentence
//    walletFailed      — the student's balance's failure sentence
//    mistToCoins       — the only unit maths on this page
//    useNetworks       — the MOVE network map (own fetch)
//    useFaucetInfo     — faucet address + balance, polled
//    useWalletBalance  — the student's balance, from the
//                        public GraphQL endpoint
//    LoadingSkeleton   — full-page skeleton layout
//    WalletPicker      — a choice when two Sui wallets announce
//    NetworkNote       — which network to select in the wallet
//    FaucetRows        — the faucet's numbers, or its failure
//    ReturnAddressCard — return address + QR
//    FaucetMOVE        — page state + layout (default export)
// -----------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-qr-code';
import axios from 'axios';

import { Alert, Button, Box, Skeleton, Stack, CircularProgress } from '@mui/material';
import PaidIcon from '@mui/icons-material/Paid';

import AssetIcon from '@/components/AssetIcon';
import ErrorCard from '@/components/ErrorCard';
import PayoutMessage from '@/components/PayoutMessage';
import FailureNote from '@/components/FailureNote';
import { WalletStepper, WalletGateButton, FadingAlert, useAlerts } from '@/components/WalletFlow';
import { MalformedAnswerError, RefusalError, requestErrorText, withNextStep } from '@/utils/requestError';
import { payoutTxid } from '@/utils/payout';

import useSuiWallet from './useSuiWallet';


// How often both balances repoll
const MOVE_REFRESH_MS = 5000;

// The wallet UI's own network labels, by the config's flavour
// key — what the student has to click on in the selector
const NETWORK_LABELS = { mainnet: 'Mainnet', testnet: 'Testnet', devnet: 'Devnet' };

// What a failed claim says when neither the wallet nor the
// backend had words of their own — requestErrorText adds the
// reason after it
const CLAIM_FAILED = 'Nepavyko išsiųsti kriptovaliutos.';

// What a failed read of the network list says when the
// backend gave no sentence of its own
const NETWORKS_FAILED = 'Nepavyko gauti tinklų sąrašo.';

// The same for a failed read of the faucet's info
const FAUCET_FAILED = 'Nepavyko gauti čiaupo informacijos.';







// -----------------------------------------------------------
// walletFailed
// -----------------------------------------------------------
//
// What the student's balance row says under its dash when the
// public GraphQL endpoint could not read the balance — named
// after the wallet in use, as the row itself is.
//
// Used by:
//   - FaucetMOVE (below) — the student's balance row
// -----------------------------------------------------------

const walletFailed = (walletName) => `Nepavyko gauti jūsų ${walletName} balanso.`;


// MIST are integers; the chain's decimals come from the
// network payload (9 on Sui, but it is a chain fact, not a
// constant to hardcode here)
const mistToCoins = (mist, decimals) => mist / 10 ** decimals;







// -----------------------------------------------------------
// useNetworks
// -----------------------------------------------------------
//
// The MOVE network map, the page's own fetch — the navbar
// reads the bundled /api/faucet/catalog instead, so nothing
// shares this cache entry. The hook hands back the map and
// whether it failed, which is true only when the map NEVER
// arrived — a failed refresh of a map already on screen
// keeps it. An answer without a networks map (a proxy's page
// with HTTP 200, an empty object) is a failed fetch too, so
// the page says the list is missing instead of waiting for
// it on a skeleton. The error behind a failure comes along,
// for the page to say what went wrong.
//
// Used by:
//   - FaucetMOVE (below)
// -----------------------------------------------------------

function useNetworks() {
  const { data, isError, error } = useQuery({
    queryKey: ['move-networks'],
    queryFn: async () => {
      const list = (await axios.get('/api/move/networks')).data;
      const map = list?.networks;
      if (!map || typeof map !== 'object' || Array.isArray(map)) throw new MalformedAnswerError();
      return list;
    },
    staleTime: 5 * 60 * 1000,
  });

  const networks = data?.networks ?? null;
  return { networks, failed: isError && !networks, error };
}







// -----------------------------------------------------------
// useFaucetInfo
// -----------------------------------------------------------
//
// The faucet's address and balance (with the payout size),
// repolled every 5 s. The backend caches it ~10 s and drops
// that cache after a payout. `ready` gates the poll on the
// catalog knowing this network, so an unknown :network in the
// URL doesn't repoll a 400 forever.
//
// The hook hands back the info — null until the first answer
// — and whether it failed. Only a read that NEVER succeeded
// is a failure; a failed repoll keeps the last numbers on
// screen. An answer without an address or without its two
// numbers counts as a failed read too, rather than a blank
// number or a QR code of nothing. The error behind a failure
// comes along, for the page to say what went wrong. The poll
// goes on after a failure, so the page recovers by itself.
//
// Used by:
//   - FaucetMOVE (below)
// -----------------------------------------------------------

function useFaucetInfo(network, ready) {
  const { data, isLoadingError, error } = useQuery({
    queryKey: ['move-faucet-balance', network],
    queryFn: async () => {
      const info = (await axios.get(`/api/move/${network}/faucet-balance`)).data;
      const complete = typeof info?.address === 'string' && info.address
        && Number.isFinite(info.balance) && Number.isFinite(info.chunk_size);
      if (!complete) throw new MalformedAnswerError();
      return info;
    },
    enabled: Boolean(ready),
    refetchInterval: MOVE_REFRESH_MS,
  });

  return { faucetInfo: data ?? null, failed: isLoadingError, error };
}







// -----------------------------------------------------------
// useWalletBalance
// -----------------------------------------------------------
//
// The student's OWN balance in MIST, read with one GraphQL
// query against the PUBLIC endpoint from the network payload
// — never the backend's own RPC. The Sui SDKs would pull a
// mountain of library to wrap this one POST. Only polls once
// an address is connected. The hook hands back the MIST (null
// until the first answer), whether the last read failed and
// the error behind it — the endpoint's refusal in its own
// words, or an answer of the wrong shape.
//
// A GraphQL error arrives with HTTP 200, and so does a
// proxy's page that is no GraphQL answer at all; both are
// thrown here to reach `failed` — the page shows a dash
// rather than a made-up zero or a permanent "Kraunama…". A
// real GraphQL answer that names no balance is a wallet that
// never held the coin: a true zero.
//
// Used by:
//   - FaucetMOVE (below)
// -----------------------------------------------------------

function useWalletBalance(rpcUrl, coinType, address) {
  const { data = null, isError, error } = useQuery({
    queryKey: ['move-wallet-balance', rpcUrl, address],
    enabled: Boolean(rpcUrl && address),
    refetchInterval: MOVE_REFRESH_MS,
    queryFn: async () => {
      const { data } = await axios.post(rpcUrl, {
        query: `query($a: SuiAddress!, $t: String!) {
          address(address: $a) { balance(coinType: $t) { totalBalance } } }`,
        variables: { a: address, t: coinType },
      });
      if (data?.errors) throw new RefusalError('Sui GraphQL', data.errors[0]?.message || '');
      if (!data?.data || typeof data.data !== 'object') throw new MalformedAnswerError();

      // No balance entry in a real answer: the coin was never held
      const total = data.data.address?.balance?.totalBalance;
      if (total == null) return 0;
      const mist = Number(total);
      if (!Number.isFinite(mist)) throw new MalformedAnswerError();
      return mist;
    },
  });

  return { mist: data, failed: isError, error };
}







// -----------------------------------------------------------
// LoadingSkeleton
// -----------------------------------------------------------
//
// The page as grey bones, shown until the network catalog and
// the faucet info have arrived — or the faucet info has
// failed, which the page itself then says.
//
// Used by:
//   - FaucetMOVE (below)
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
// WalletPicker
// -----------------------------------------------------------
//
// Shown only when the browser announced MORE than one
// Sui-capable wallet (Slush beside a Sui-capable Phantom):
// the hook talks to the first one announced, which the
// student did not choose — this row lets them. Two wallets
// can carry the same name, so the one in use is found by
// identity, never by name.
//
// Used by:
//   - FaucetMOVE (below) — above the gate button
// -----------------------------------------------------------

function WalletPicker({ wallets, inUse, onSelect }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-700">Piniginė:</span>
      {/* A wallet carries no id and its name can repeat, so a
          button is keyed by its place in the list — the
          buttons hold no state a shift could carry over */}
      {wallets.map((candidate, index) => (
        <Button
          key={index}
          size="small"
          variant={candidate === inUse ? 'contained' : 'outlined'}
          onClick={() => onSelect(candidate)}
        >
          {candidate.name}
        </Button>
      ))}
    </div>
  );
}







// -----------------------------------------------------------
// NetworkNote
// -----------------------------------------------------------
//
// The clicks a Sui wallet will not do for us: a Sui address
// is the same on every network, but the wallet UI still has
// a network selector (Slush and Suiet ship on Mainnet), and
// the faucet pays on the network in the URL — so a student on
// the wrong one sees the page's balance rise and the wallet
// show nothing. Always on screen once a wallet is known;
// amber when the account advertises chains that do not
// include ours, quiet otherwise (a wallet that lists every
// network it supports cannot be checked).
//
// Used by:
//   - FaucetMOVE (below) — under the gate / claim button
// -----------------------------------------------------------

function NetworkNote({ walletName, network, chains }) {
  const label = NETWORK_LABELS[network] ?? network;
  const wrong = chains.length > 0 && !chains.includes(`sui:${network}`);
  const tone = wrong
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-gray-200 bg-gray-50 text-gray-700';

  return (
    <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${tone}`}>
      <p className="font-semibold">
        {wrong
          ? `${walletName} šiuo metu rodo kitą tinklą.`
          : `Tinklas pasirenkamas pačioje ${walletName} piniginėje.`}
      </p>
      <p className="mt-1">
        Atidarykite {walletName} ir tinklo sąraše pasirinkite „{label}“.
        Čiaupo monetos visada keliauja į {label} tinklą — jei piniginė
        rodo kitą tinklą, gautų monetų ten nematysite.
      </p>
    </div>
  );
}







// -----------------------------------------------------------
// FaucetRows
// -----------------------------------------------------------
//
// The faucet's two lines in the balance card — what one claim
// pays and what the faucet holds — or, when its info could not
// be read, the sentence saying what went wrong in their place.
//
// Used by:
//   - FaucetMOVE (below) — the balance card
// -----------------------------------------------------------

function FaucetRows({ faucetInfo, failed, failure, shortName }) {

  if (failed) {
    return <Alert severity="error" sx={{ my: 1 }}>{failure}</Alert>;
  }


  return (
    <>
      <div className="my-2 flex">
        <span className="flex-1">Išsiųsime jums:</span>
        <span className="text-right">{parseFloat(faucetInfo.chunk_size).toFixed(3)} {shortName}</span>
      </div>
      <div className="my-2 flex">
        <span className="flex-1">Čiaupo balansas:</span>
        <span className="text-right">{parseFloat(faucetInfo.balance).toFixed(3)} {shortName}</span>
      </div>
    </>
  );
}







// -----------------------------------------------------------
// ReturnAddressCard
// -----------------------------------------------------------
//
// The faucet's own address as text + QR so leftover coins can
// be sent back.
//
// Used by:
//   - FaucetMOVE (below)
// -----------------------------------------------------------

function ReturnAddressCard({ shortName, address }) {
  return (
    <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[640px] p-4">
      <div className="my-2 flex items-start gap-4">
        <span className="min-w-0 flex-1">
          Grąžinkite nebereikalingą <u><b>{shortName}</b></u> krypto atgal:
          <br /><br /><span className="break-all">{address}</span>
        </span>
        <QRCode value={address} size={128} />
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// FaucetMOVE (default export)
// -----------------------------------------------------------
//
// The page: the discovered Sui wallet wired into the stepper
// (three steps — no network hop exists), the balance rows,
// the claim button and the alerts. Faucet info that could not
// be read does not hold the page back — the student still
// installs, picks and connects a wallet; only the claim waits
// for the info, as on the UTXO page.
//
// Used by:
//   - App.jsx — route /faucet/move/:network
// -----------------------------------------------------------

export default function FaucetMOVE() {

  const { network } = useParams();
  const { networks, failed: catalogFailed, error: catalogError } = useNetworks();
  const networkInfo = networks?.[network] ?? null;
  const unknownNetwork = Boolean(networks) && !networkInfo;

  const graphqlUrl = networkInfo?.rpc_urls?.[0] ?? null;
  const wallet = useSuiWallet();

  const { faucetInfo, failed: faucetFailed, error: faucetError } = useFaucetInfo(network, networkInfo);
  const walletBalance = useWalletBalance(graphqlUrl, networkInfo?.coin_type, wallet.address);

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
  // The success alert names the transaction (payoutTxid); a
  // failure reads in Lithuanian whatever broke — the wallet's
  // own words for a refusal inside it, the backend's sentence
  // for its refusals, the page's sentence with the reason
  // after it for anything else (requestErrorText). An answer
  // that arrives after a network switch is dropped: it
  // belongs to the chain it was issued for.
  const claim = async () => {
    const forNetwork = network;
    setClaimingFor(forNetwork);
    try {
      const { nonce, signature } = await wallet.signMessage();

      const { data } = await axios.get(`/api/move/${forNetwork}/request`, {
        params: { address: wallet.address, signature, nonce },
      });
      const txid = payoutTxid(data, 'transaction_id', CLAIM_FAILED);

      queryClient.invalidateQueries({ queryKey: ['move-faucet-balance', forNetwork] });
      queryClient.invalidateQueries({ queryKey: ['move-wallet-balance', graphqlUrl, wallet.address] });
      if (networkRef.current !== forNetwork) return;
      addAlert('success', (
        <PayoutMessage
          sentence={`${networkInfo.full_name} išsiųstas į jūsų piniginę.`}
          txid={txid}
          explorer={networkInfo.block_explorer_urls?.[0]}
        />
      ));
    } catch (e) {
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

  // A faucet info that failed is no reason to wait: the page
  // shows its notice instead of the numbers
  if (!networkInfo || (!faucetInfo && !faucetFailed)) {
    return <LoadingSkeleton />;
  }


  // Four distinct states, and they must not blur into each
  // other: a dead public endpoint is a dash, not a zero balance
  const walletBalanceText = () => {
    if (wallet.step !== 3) return 'Piniginė neprijungta';
    if (walletBalance.failed) return '-';
    if (walletBalance.mist == null) return 'Kraunama…';
    return `${mistToCoins(walletBalance.mist, networkInfo.decimals).toFixed(3)} ${networkInfo.short_name}`;
  };


  // The claim takes no click while one is in flight, nor while
  // the faucet info could not be read
  const claimBlocked = claiming || faucetFailed;


  // Three steps — Sui wallets need no network hop, so
  // wallet.step jumps 1 → 3 and the stepper index clamps to
  // the last label
  const steps = [
    `Susidiegti ${wallet.walletName}`,
    `Prijungti ${wallet.walletName}`,
    `Atsisiųsti ${networkInfo.full_name}`,
  ];


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

      {/* The three-step flow. The last step's default icon is
          the Ethereum diamond, so this page overrides it with
          a coin. */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
        <WalletStepper
          activeStep={Math.min(wallet.step, steps.length - 1)}
          icons={{ [steps.length - 1]: <PaidIcon /> }}
          steps={steps}
        />
      </div>

      {/* Balances, the claim button and its outcome alerts */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">

        <div className="my-2 flex">
          <span className="flex-1">Jūsų {wallet.walletName} balansas:</span>
          <span className="text-right">{walletBalanceText()}</span>
        </div>
        {wallet.step === 3 && walletBalance.failed && (
          <FailureNote>{requestErrorText(walletBalance.error, walletFailed(wallet.walletName), 'Sui GraphQL')}</FailureNote>
        )}
        <FaucetRows
          faucetInfo={faucetInfo}
          failed={faucetFailed}
          failure={requestErrorText(faucetError, FAUCET_FAILED)}
          shortName={networkInfo.short_name}
        />

        <div className="mt-3">
          {wallet.wallets.length > 1 && (
            <WalletPicker wallets={wallet.wallets} inUse={wallet.inUse} onSelect={wallet.selectWallet} />
          )}

          <WalletGateButton
            step={wallet.step}
            networkInfo={networkInfo}
            walletName={wallet.walletName}
            installUrl={wallet.installUrl}
            onConnect={wallet.connect}
            onSwitch={async () => {}}
            onError={(msg) => addAlert('error', msg)}
          />

          {wallet.step === 3 && (
            <Button
              variant="contained"
              color="primary"
              fullWidth
              aria-busy={claiming}
              aria-disabled={claimBlocked}
              onClick={claimBlocked ? undefined : claim}
              sx={{ minHeight: 40, '&[aria-disabled="true"]': { opacity: 0.6, pointerEvents: 'none' } }}
            >
              {claiming && <CircularProgress size={22} color="inherit" aria-hidden="true" sx={{ mr: 1 }} />}
              {claiming ? 'Siunčiama…' : `Gauti ${networkInfo.full_name} valiutos`}
            </Button>
          )}

          {wallet.installed && (
            <NetworkNote walletName={wallet.walletName} network={networkInfo.network} chains={wallet.chains} />
          )}
        </div>

        {alerts.map((a) => (
          <FadingAlert key={a.id} severity={a.severity} onDone={a.dismiss}>
            {a.message}
          </FadingAlert>
        ))}
      </div>

      {faucetInfo && <ReturnAddressCard shortName={networkInfo.short_name} address={faucetInfo.address} />}

    </Box>
  );
}
