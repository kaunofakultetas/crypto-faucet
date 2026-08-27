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
//  (GET /api/move/<network>/request). The student's own
//  balance is read straight from the network's public GraphQL
//  endpoint (from the catalog payload). The faucet's return
//  address renders as text + QR — hex is case-insensitive,
//  but it is kept as the backend prints it.
//
//  One thing the wallet will not do for the student: a Sui
//  address is the same on every network, but the wallet UI
//  has a network selector (shipped on Mainnet), and the
//  faucet pays on the network in the URL — so the page keeps
//  a note on screen naming the network to select, amber when
//  the wallet says it is on another one.
//
//  Split into (root component last):
//
//    MOVE_REFRESH_MS   — balance repoll cadence
//    NETWORK_LABELS    — flavour key → the wallet's label
//    mistToCoins       — the only unit maths on this page
//    useNetworks       — the MOVE network map (own fetch)
//    useFaucetInfo     — faucet address + balance, polled
//    useWalletBalance  — the student's balance, from the
//                        public GraphQL endpoint
//    LoadingSkeleton   — full-page skeleton layout
//    WalletPicker      — a choice when two Sui wallets announce
//    NetworkNote       — which network to select in the wallet
//    ReturnAddressCard — return address + QR
//    FaucetMOVE        — page state + layout (default export)
// -----------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-qr-code';
import axios from 'axios';

import { Button, Box, Skeleton, Stack, CircularProgress } from '@mui/material';
import PaidIcon from '@mui/icons-material/Paid';

import AssetIcon from '@/components/AssetIcon';
import ErrorCard from '@/components/ErrorCard';
import { WalletStepper, WalletGateButton, FadingAlert, useAlerts } from '@/components/WalletFlow';

import useSuiWallet from './useSuiWallet';


// How often both balances repoll
const MOVE_REFRESH_MS = 5000;

// The wallet UI's own network labels, by the config's flavour
// key — what the student has to click on in the selector
const NETWORK_LABELS = { mainnet: 'Mainnet', testnet: 'Testnet', devnet: 'Devnet' };


// MIST are integers; the chain's decimals come from the
// network payload (9 on Sui, but it is a chain fact, not a
// constant to hardcode here)
const mistToCoins = (mist, decimals) => mist / 10 ** decimals;







// -----------------------------------------------------------
// useNetworks
// -----------------------------------------------------------
//
//   const { networks, failed } = useNetworks()
//
// The MOVE network map, the page's own fetch — the navbar
// reads the bundled /api/faucet/catalog instead, so nothing
// shares this cache entry. failed is true only when the map
// NEVER arrived — a failed refresh of a map already on
// screen keeps it.
//
// Used by:
//   - FaucetMOVE (below)
// -----------------------------------------------------------

function useNetworks() {
  const { data, isError } = useQuery({
    queryKey: ['move-networks'],
    queryFn: async () => (await axios.get('/api/move/networks')).data,
    staleTime: 5 * 60 * 1000,
  });

  const networks = data?.networks ?? null;
  return { networks, failed: isError && !networks };
}







// -----------------------------------------------------------
// useFaucetInfo
// -----------------------------------------------------------
//
//   const faucetInfo = useFaucetInfo(network, ready)
//
// The faucet's address and balance ({ address, balance,
// symbol, chunk_size }), repolled every 5 s. The backend
// caches it ~10 s and drops that cache after a payout.
// `ready` gates the poll on the catalog knowing this network,
// so an unknown :network in the URL doesn't repoll a 400
// forever.
//
// Used by:
//   - FaucetMOVE (below)
// -----------------------------------------------------------

function useFaucetInfo(network, ready) {
  const { data = null } = useQuery({
    queryKey: ['move-faucet-balance', network],
    queryFn: async () => (await axios.get(`/api/move/${network}/faucet-balance`)).data,
    enabled: Boolean(ready),
    refetchInterval: MOVE_REFRESH_MS,
  });

  return data;
}







// -----------------------------------------------------------
// useWalletBalance
// -----------------------------------------------------------
//
//   const { mist, failed } = useWalletBalance(rpcUrl,
//     coinType, address)
//
// The student's OWN balance, read with one GraphQL query
// against the PUBLIC endpoint from the network payload —
// never the backend's own RPC. The Sui SDKs would pull a
// mountain of library to wrap this one POST. Only polls once
// an address is connected.
//
// A GraphQL error arrives with HTTP 200, so it is rethrown
// here to reach `failed` — the page shows a dash rather than
// a zero or a permanent "Loading…".
//
// Used by:
//   - FaucetMOVE (below)
// -----------------------------------------------------------

function useWalletBalance(rpcUrl, coinType, address) {
  const { data = null, isError } = useQuery({
    queryKey: ['move-wallet-balance', rpcUrl, address],
    enabled: Boolean(rpcUrl && address),
    refetchInterval: MOVE_REFRESH_MS,
    queryFn: async () => {
      const { data } = await axios.post(rpcUrl, {
        query: `query($a: SuiAddress!, $t: String!) {
          address(address: $a) { balance(coinType: $t) { totalBalance } } }`,
        variables: { a: address, t: coinType },
      });
      if (data?.errors) throw new Error(data.errors[0]?.message || 'Sui GraphQL error');
      return Number(data?.data?.address?.balance?.totalBalance ?? 0);
    },
  });

  return { mist: data, failed: isError };
}







// -----------------------------------------------------------
// LoadingSkeleton
// -----------------------------------------------------------
//
// The page as grey bones, shown until the network catalog and
// the faucet info have arrived.
//
// Used by:
//   - FaucetMOVE (below)
// -----------------------------------------------------------

function LoadingSkeleton() {
  return (
    <Box className="p-4">
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
// student did not choose — this row lets them.
//
// Used by:
//   - FaucetMOVE (below) — above the gate button
// -----------------------------------------------------------

function WalletPicker({ wallets, current, onSelect }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-700">Piniginė:</span>
      {wallets.map((candidate) => (
        <Button
          key={candidate.name}
          size="small"
          variant={candidate.name === current ? 'contained' : 'outlined'}
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
// the claim button and the alerts.
//
// Used by:
//   - App.jsx — route /faucet/move/:network
// -----------------------------------------------------------

export default function FaucetMOVE() {

  const { network } = useParams();
  const { networks, failed: catalogFailed } = useNetworks();
  const networkInfo = networks?.[network] ?? null;
  const unknownNetwork = Boolean(networks) && !networkInfo;

  const graphqlUrl = networkInfo?.rpc_urls?.[0] ?? null;
  const wallet = useSuiWallet();

  const faucetInfo = useFaucetInfo(network, networkInfo);
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
  // An answer that arrives after a network switch is dropped:
  // it belongs to the chain it was issued for.
  const claim = async () => {
    const forNetwork = network;
    setClaimingFor(forNetwork);
    try {
      const { nonce, signature } = await wallet.signMessage();

      await axios.get(`/api/move/${forNetwork}/request`, {
        params: { address: wallet.address, signature, nonce },
      });

      queryClient.invalidateQueries({ queryKey: ['move-faucet-balance', forNetwork] });
      queryClient.invalidateQueries({ queryKey: ['move-wallet-balance', graphqlUrl, wallet.address] });
      if (networkRef.current !== forNetwork) return;
      addAlert('success', `${networkInfo.full_name} išsiųstas į jūsų piniginę.`);
    } catch (e) {
      // Backend refusals arrive as { error } in the response
      // body; wallet errors (signature refused) only carry a
      // message
      if (networkRef.current !== forNetwork) return;
      addAlert('error', e.response?.data?.error || e.message || 'Nepavyko išsiųsti kriptovaliutos.');
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

  if (!networkInfo || !faucetInfo) {
    return <LoadingSkeleton />;
  }


  // Four distinct states, and they must not blur into each
  // other: a dead public endpoint is a dash, not a zero balance
  const walletBalanceText = () => {
    if (wallet.step !== 3) return 'Piniginė neprijungta';
    if (walletBalance.failed) return '-';
    if (walletBalance.mist == null) return 'Loading…';
    return `${mistToCoins(walletBalance.mist, networkInfo.decimals).toFixed(3)} ${networkInfo.short_name}`;
  };


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
        <div className="my-2 flex">
          <span className="flex-1">Išsiųsime jums:</span>
          <span className="text-right">{parseFloat(faucetInfo.chunk_size).toFixed(3)} {networkInfo.short_name}</span>
        </div>
        <div className="my-2 flex">
          <span className="flex-1">Čiaupo balansas:</span>
          <span className="text-right">{parseFloat(faucetInfo.balance).toFixed(3)} {networkInfo.short_name}</span>
        </div>

        <div className="mt-3">
          {wallet.wallets.length > 1 && (
            <WalletPicker wallets={wallet.wallets} current={wallet.walletName} onSelect={wallet.selectWallet} />
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
              disabled={claiming}
              onClick={claim}
              sx={{ minHeight: 40 }}
            >
              {claiming
                ? <CircularProgress size={22} color="inherit" />
                : `Gauti ${networkInfo.full_name} valiutos`}
            </Button>
          )}

          {wallet.installed && (
            <NetworkNote walletName={wallet.walletName} network={networkInfo.network} chains={wallet.chains} />
          )}
        </div>

        {alerts.map((a) => (
          <FadingAlert key={a.id} severity={a.severity}>
            {a.message}
          </FadingAlert>
        ))}
      </div>

      <ReturnAddressCard shortName={networkInfo.short_name} address={faucetInfo.address} />

    </Box>
  );
}
