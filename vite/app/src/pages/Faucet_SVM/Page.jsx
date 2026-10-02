// -----------------------------------------------------------
//  [*] Pages — SVM Faucet (route /faucet/svm/:network)
//
//  The student-facing faucet for SVM chains (Solana, on the
//  cluster each network's config names — Devnet today).
//  Laid out like the EVM page — title, stepper, balances,
//  claim, return address — but the wallet underneath is
//  Phantom, not MetaMask:
//
//    - install / connect talk to window.phantom.solana
//      (see usePhantomWallet.js), never window.ethereum
//    - the ownership proof is an Ed25519 signature over the
//      same Lithuanian nonce message, sent base58-encoded
//    - Phantom cannot always hop clusters on request, and
//      never reports the one it is showing, so the cluster
//      step passes on the click and ClusterInstructions — the
//      Testnet Mode clicks for the network's own cluster —
//      stays on screen until the hop was confirmed
//
//  Claiming signs a nonce the backend verifies before sending
//  (GET /api/svm/<network>/request); the success alert names
//  the payout's transaction, linked to the network's
//  explorer. The faucet's return address renders as text +
//  QR. There is no transaction-graph shortcut — /graph is
//  Etherscan-based.
//
//  No answer of the backend leaves the page hanging: a network
//  list without its map gets the list's failure card, faucet
//  info that never arrived (or arrived in another shape) a
//  failure notice on a page whose wallet steps still work, and
//  a failed claim a Lithuanian sentence.
//
//  Split into (root component last):
//
//    SVM_REFRESH_MS      — balance repoll cadence
//    PHANTOM_*           — wallet name + download link
//    PHANTOM_CLUSTERS    — Phantom's own names for a cluster
//    CLAIM_FAILED        — the claim's own failure sentence
//    lamportsToCoins     — the only unit maths on this page
//    useNetworks         — the SVM network catalog (own fetch)
//    useFaucetInfo       — faucet address + balance, polled
//    useWalletBalance    — the student's cluster balance, from
//                          the public cluster JSON-RPC
//    ClusterInstructions — the manual Testnet Mode clicks
//    LoadingSkeleton     — full-page skeleton layout
//    FaucetRows          — the faucet's numbers, or its failure
//    ReturnAddressCard   — return address + QR
//    FaucetSVM           — page state + layout (default export)
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
import { WalletStepper, WalletGateButton, FadingAlert, useAlerts } from '@/components/WalletFlow';
import { requestErrorText } from '@/utils/requestError';
import { payoutTxid } from '@/utils/payout';

import usePhantomWallet from './usePhantomWallet';


// How often both balances repoll
const SVM_REFRESH_MS = 5000;

// Official Phantom download — the extension, not the mobile
// app store listing
const PHANTOM_NAME = 'Phantom';
const PHANTOM_DOWNLOAD_URL = 'https://phantom.com/download';

// Phantom's own names for the clusters its Testnet Mode lists
// — what the student has to pick there — and the short name
// the coins sentence uses; a cluster Phantom does not list is
// called by its config key
const PHANTOM_CLUSTERS = {
  devnet: { label: 'Solana Devnet', short: 'Devnet' },
  testnet: { label: 'Solana Testnet', short: 'Testnet' },
};

// What a failed claim says when neither the wallet nor the
// backend had words of their own — requestErrorText adds the
// reason after it
const CLAIM_FAILED = 'Nepavyko išsiųsti kriptovaliutos.';


// Lamports are integers; the chain's decimals come from the
// network payload (9 on every SVM chain so far, but it is a
// chain fact, not a constant to hardcode here)
const lamportsToCoins = (lamports, decimals) => lamports / 10 ** decimals;







// -----------------------------------------------------------
// useNetworks
// -----------------------------------------------------------
//
// The SVM network map, the page's own fetch — the navbar
// reads the bundled /api/faucet/catalog instead, so nothing
// shares this cache entry. The hook hands back the map and
// whether it failed, which is true only when the map NEVER
// arrived — a failed refresh of a map already on screen
// keeps it. An answer without a networks map (a proxy's page
// with HTTP 200, an empty object) is a failed fetch too, so
// the page says the list is missing instead of waiting for
// it on a skeleton.
//
// Used by:
//   - FaucetSVM (below)
// -----------------------------------------------------------

function useNetworks() {
  const { data, isError } = useQuery({
    queryKey: ['svm-networks'],
    queryFn: async () => {
      const list = (await axios.get('/api/svm/networks')).data;
      const map = list?.networks;
      if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('no networks map in the answer');
      return list;
    },
    staleTime: 5 * 60 * 1000,
  });

  const networks = data?.networks ?? null;
  return { networks, failed: isError && !networks };
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
// number or a QR code of nothing. The poll goes on after a
// failure, so the page recovers by itself.
//
// Used by:
//   - FaucetSVM (below)
// -----------------------------------------------------------

function useFaucetInfo(network, ready) {
  const { data, isLoadingError } = useQuery({
    queryKey: ['svm-faucet-balance', network],
    queryFn: async () => {
      const info = (await axios.get(`/api/svm/${network}/faucet-balance`)).data;
      const complete = typeof info?.address === 'string' && info.address
        && Number.isFinite(info.balance) && Number.isFinite(info.chunk_size);
      if (!complete) throw new Error('not a faucet balance answer');
      return info;
    },
    enabled: Boolean(ready),
    refetchInterval: SVM_REFRESH_MS,
  });

  return { faucetInfo: data ?? null, failed: isLoadingError };
}







// -----------------------------------------------------------
// useWalletBalance
// -----------------------------------------------------------
//
// The student's OWN balance in lamports, read with a plain
// getBalance JSON-RPC call against the PUBLIC cluster RPC
// from the network payload — never the backend's keyed
// Infura URL. @solana/web3.js would pull a megabyte of
// library to wrap this one POST. Only polls once an address
// is connected. The hook hands back the lamports (null until
// the first answer) and whether the last read failed.
//
// A JSON-RPC error arrives with HTTP 200, and so does a
// proxy's page that is no JSON-RPC answer at all; both are
// thrown here to reach `failed`, as is any answer whose
// result carries no number — the page shows a dash rather
// than a zero or a permanent "Kraunama…".
//
// This is always the faucet's cluster, even if Phantom's UI is
// still on mainnet — that is why the cluster step exists: so
// the number here and the number in Phantom agree.
//
// Used by:
//   - FaucetSVM (below)
// -----------------------------------------------------------

function useWalletBalance(rpcUrl, address) {
  const { data = null, isError } = useQuery({
    queryKey: ['svm-wallet-balance', rpcUrl, address],
    enabled: Boolean(rpcUrl && address),
    refetchInterval: SVM_REFRESH_MS,
    queryFn: async () => {
      const { data } = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address, { commitment: 'confirmed' }],
      });
      if (data?.error) throw new Error(data.error.message || 'Solana RPC error');

      // Zero is a balance; a missing number is not
      const lamports = data?.result?.value;
      if (!Number.isFinite(lamports)) throw new Error('Solana RPC answered without a balance');
      return lamports;
    },
  });

  return { lamports: data, failed: isError };
}







// -----------------------------------------------------------
// ClusterInstructions
// -----------------------------------------------------------
//
// The clicks Phantom will not do for us: a test cluster is
// Testnet Mode inside the extension, then the cluster picked
// by Phantom's own name for it. Shown on the cluster step,
// and afterwards too whenever the hop could not be confirmed
// — otherwise students stay on "Solana" (mainnet) and never
// see the coins this page sent. Every line names the
// network's OWN cluster: a Testnet faucet must not send the
// student to Devnet.
//
// Used by:
//   - FaucetSVM (below) — the gate's switchHelp and the
//     unconfirmed-cluster notice
// -----------------------------------------------------------

function ClusterInstructions({ cluster }) {

  const { label, short } = PHANTOM_CLUSTERS[cluster] ?? { label: cluster, short: cluster };


  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p className="font-semibold">Phantom {label} įjungiamas taip:</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>Atidarykite Phantom plėtinį</li>
        <li>Nustatymai (⚙️) → Developer Settings → Testnet Mode</li>
        <li>Tinklo sąraše pasirinkite „{label}“, ne „Solana“</li>
      </ol>
      <p className="mt-1">
        Čiaupo monetos visada keliauja į {short}. Jei piniginė vis dar
        rodo mainnet, gautų monetų ten nematysite.
      </p>
    </div>
  );
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
//   - FaucetSVM (below)
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
// FaucetRows
// -----------------------------------------------------------
//
// The faucet's two lines in the balance card — what one claim
// pays and what the faucet holds — or, when its info could not
// be read, the page's failure notice in their place, as the
// UTXO page shows it.
//
// Used by:
//   - FaucetSVM (below) — the balance card
// -----------------------------------------------------------

function FaucetRows({ faucetInfo, failed, shortName }) {

  if (failed) {
    return <Alert severity="error" sx={{ my: 1 }}>Nepavyko gauti čiaupo informacijos</Alert>;
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
// be sent back. Base58 is case-SENSITIVE, so unlike the EVM
// page this is NOT lowercased — folding the case would corrupt
// the address and the QR with it.
//
// Used by:
//   - FaucetSVM (below)
// -----------------------------------------------------------

function ReturnAddressCard({ shortName, address }) {
  return (
    <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[640px] p-4">
      <div className="my-2 flex items-start gap-4">
        <span className="flex-1">
          Grąžinkite nebereikalingą <u><b>{shortName}</b></u> krypto atgal:
          <br /><br />{address}
        </span>
        <QRCode value={address} size={128} />
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// FaucetSVM (default export)
// -----------------------------------------------------------
//
// The page: the Phantom hook wired into the stepper, the
// balance rows, the claim button and the alerts. Faucet info
// that could not be read does not hold the page back — the
// student still installs, connects and hops clusters; only
// the claim waits for the info, as on the UTXO page.
//
// Used by:
//   - App.jsx — route /faucet/svm/:network
// -----------------------------------------------------------

export default function FaucetSVM() {

  const { network } = useParams();
  const { networks, failed: catalogFailed } = useNetworks();
  const networkInfo = networks?.[network] ?? null;
  const unknownNetwork = Boolean(networks) && !networkInfo;

  const clusterRpc = networkInfo?.rpc_urls?.[0] ?? null;
  const wallet = usePhantomWallet(networkInfo?.cluster);

  const { faucetInfo, failed: faucetFailed } = useFaucetInfo(network, networkInfo);
  const walletBalance = useWalletBalance(clusterRpc, wallet.address);

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
  // failure reads in Lithuanian whatever broke — Phantom's
  // own words for a refusal inside the wallet, the backend's
  // sentence for its refusals, the page's sentence with the
  // reason after it for anything else (requestErrorText). An
  // answer that arrives after a network switch is dropped: it
  // belongs to the chain it was issued for.
  const claim = async () => {
    const forNetwork = network;
    setClaimingFor(forNetwork);
    try {
      const { nonce, signature } = await wallet.signMessage();

      const { data } = await axios.get(`/api/svm/${forNetwork}/request`, {
        params: { address: wallet.address, signature, nonce },
      });
      const txid = payoutTxid(data, 'transaction_id', CLAIM_FAILED);

      queryClient.invalidateQueries({ queryKey: ['svm-faucet-balance', forNetwork] });
      queryClient.invalidateQueries({ queryKey: ['svm-wallet-balance', clusterRpc, wallet.address] });
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
    return <ErrorCard>Nepavyko gauti tinklų sąrašo. Perkraukite puslapį.</ErrorCard>;
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
  // other: a dead public RPC is a dash, not a zero balance
  const walletBalanceText = () => {
    if (wallet.step !== 3) return 'Piniginė neprijungta';
    if (walletBalance.failed) return '-';
    if (walletBalance.lamports == null) return 'Kraunama…';
    return `${lamportsToCoins(walletBalance.lamports, networkInfo.decimals).toFixed(3)} ${networkInfo.short_name}`;
  };


  // The claim takes no click while one is in flight, nor while
  // the faucet info could not be read
  const claimBlocked = claiming || faucetFailed;


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

      {/* Install Phantom → connect → cluster → claim. The last
          step's default icon is the Ethereum diamond, so this
          page overrides it with a coin. */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
        <WalletStepper
          activeStep={wallet.step}
          icons={{ 3: <PaidIcon /> }}
          steps={[
            `Susidiegti ${PHANTOM_NAME}`,
            `Prijungti ${PHANTOM_NAME}`,
            `Įsijungti ${networkInfo.full_name} tinklą`,
            `Atsisiųsti ${networkInfo.full_name} ${networkInfo.short_name}`,
          ]}
        />
      </div>

      {/* Balances, the claim button and its outcome alerts */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">

        <div className="my-2 flex">
          <span className="flex-1">Jūsų Phantom balansas:</span>
          <span className="text-right">{walletBalanceText()}</span>
        </div>
        <FaucetRows faucetInfo={faucetInfo} failed={faucetFailed} shortName={networkInfo.short_name} />

        <div className="mt-3">
          <WalletGateButton
            step={wallet.step}
            networkInfo={networkInfo}
            walletName={PHANTOM_NAME}
            installUrl={PHANTOM_DOWNLOAD_URL}
            switchHelp={<ClusterInstructions cluster={networkInfo.cluster} />}
            onConnect={wallet.connect}
            onSwitch={wallet.switchNetwork}
            onError={(msg) => addAlert('error', msg)}
          />

          {wallet.step === 3 && (
            <>
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

              {/* Phantom could not confirm the hop, so the
                  wallet may still be showing mainnet — a
                  network that names no cluster has no hop to
                  explain */}
              {networkInfo.cluster && !wallet.clusterConfirmed && <ClusterInstructions cluster={networkInfo.cluster} />}
            </>
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
