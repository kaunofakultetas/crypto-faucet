// -----------------------------------------------------------
//  [*] Pages — ERC-20 Faucet (route /faucet/erc20/:token)
//
//  The faucet for ERC-20 TEST TOKENS, keyed by the TOKEN —
//  "I need LINK" comes before "on which chain". One page
//  shows the token on every chain it is deployed on
//  (GET /api/erc20/token/<symbol>), one claim card per chain,
//  outcomes rendered inside the card that caused them.
//
//  Two things set this page apart from the native faucets:
//  the wallet must sit on a TOKEN chain before claiming, and
//  USING tokens needs gas the student may not have — so the
//  flow is FIVE steps (install → connect → token network →
//  gas → claim), and the backend enforces both gates on the
//  same numbers the page shows. The details live on the
//  pieces: the ladder in deriveFlow, the gas economics in
//  hasEnoughGas + GasNoticeCard, the tokens-are-invisible-
//  until-imported story in watchTokenInMetamask.
//
//  Split into (root component last) — the step ladder and
//  the wallet conversation are plain functions with no React
//  in them; the root keeps state, handlers and layout:
//
//    TOKEN_REFRESH_MS  — token payload repoll cadence
//    useToken          — the token + its deployments, polled
//    hasEnoughGas      — the per-chain gas verdict
//    deriveFlow        — the five-step ladder + switch target
//    watchTokenInMetamask — the wallet_watchAsset conversation
//    AddressRow        — mono address + copy button
//    GateCard          — stepper + gate button + gate alerts
//    GasNoticeCard     — the "get native crypto first" card
//    ChainCard         — one chain: dot, balances, claim,
//                        show-in-MetaMask, its own alerts
//    ReturnAddressCard — send leftover tokens back (+ QR)
//    LoadingSkeleton   — full-page skeleton layout
//    useTokenActions   — claim + show-in-MetaMask handlers
//    FaucetERC20       — page state + layout (default export)
// -----------------------------------------------------------

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import QRCode from 'react-qr-code';

import { Button, Box, Skeleton, Stack, CircularProgress, Chip, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';

import useMetamaskWallet, { getMetamaskProvider } from '@/hooks/useMetamaskWallet';
import { WalletStepper, WalletGateButton, FadingAlert, useAlerts } from '@/components/WalletFlow';
import AssetIcon from '@/components/AssetIcon';
import ErrorCard from '@/components/ErrorCard';


// How often the token payload (with the faucet's per-chain
// balances) repolls — the backend caches those ~10 s anyway
const TOKEN_REFRESH_MS = 10000;







// -----------------------------------------------------------
// useToken
// -----------------------------------------------------------
//
//   const { data, error, reload } = useToken(symbol, account)
//   data → { token, faucet_address, deployments: [...] }
//
// The whole page as ONE TanStack query, repolled every 15 s.
// With a connected account the request carries ?address= and
// every deployment comes back with that wallet's native
// balance (wallet_native_wei) — the gas gate's input, fetched
// by the BACKEND over its own RPC connections, because the
// public rpc_urls are not reliable from a browser. A token
// switch changes the key and shows skeletons; an account
// change keeps the current rows on screen while the refresh
// lands (placeholderData, same-symbol only). error holds the
// backend's message when the query NEVER got an answer (an
// unknown token) — a failed repoll keeps the last payload on
// screen, and a 4xx stops the interval so a stale bookmark
// doesn't repoll forever. reload() (after a claim)
// invalidates the query for an immediate refetch.
//
// Used by:
//   - FaucetERC20 (below)
// -----------------------------------------------------------

function useToken(symbol, account) {

  const queryClient = useQueryClient();

  const { data = null, error: queryError, isLoadingError } = useQuery({
    queryKey: ['erc20-token', symbol, account ?? null],
    // A 4xx is the backend's verdict on the SYMBOL (unknown
    // token) — stop the interval; anything else keeps polling
    // so a blip recovers on its own
    refetchInterval: (query) => {
      const status = query.state.error?.response?.status;
      return status >= 400 && status < 500 ? false : TOKEN_REFRESH_MS;
    },
    queryFn: async () => {
      const suffix = account ? `?address=${account}` : '';
      return (await axios.get(`/api/erc20/token/${symbol}${suffix}`)).data;
    },
    // Keep the previous payload only across an ACCOUNT change —
    // a different token must show skeletons, never stale rows
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[1] === symbol ? previousData : undefined,
  });

  // Only a query that never got data is an error for the page —
  // the library keeps data through a failed repoll, so a blip
  // never blanks a page that is already showing the token
  const error = isLoadingError
    ? (queryError.response?.data?.error || 'Nepavyko gauti žetono informacijos')
    : null;

  const reload = () => queryClient.invalidateQueries({ queryKey: ['erc20-token', symbol] });

  return { data, error, reload };
}







// -----------------------------------------------------------
// hasEnoughGas
// -----------------------------------------------------------
//
// Does the wallet hold the backend's min_native_wei (half
// the native chunk) on this chain? Both numbers arrive in
// the deployment itself. true / false / null when the
// balance is unknown (not connected yet, RPC hiccup).
//
// Used by:
//   - deriveFlow (below)
//   - FaucetERC20 (below) — each card's needsGas flag
// -----------------------------------------------------------

const hasEnoughGas = (deployment) => {
  const bal = deployment.wallet_native_wei;
  if (bal == null) return null;
  return BigInt(bal) >= BigInt(deployment.min_native_wei ?? 0);
};







// -----------------------------------------------------------
// deriveFlow
// -----------------------------------------------------------
//
//   const { activeStep, switchTarget, gaslessDeployments } =
//     deriveFlow(deployments, walletStep, chainId)
//
// The page's five-step ladder on top of the wallet hook's
// 0/1 (install / connect): the NETWORK step — the wallet
// must sit on ONE of the token's chains, an unrelated chain
// would hide the received tokens — then the GAS step,
// complete once at least one chain clears the threshold.
// While no balance is known yet the gas step counts as
// passed — fail open, the cards and the backend still
// enforce the rule per chain.
//
// switchTarget is where the network step's button switches
// to: the chain the wallet already sits on when it's a token
// chain, else the first chain with gas, else simply the
// first. gaslessDeployments are the chains GasNoticeCard
// lists — below the bar for sure, not merely unknown.
//
// Used by:
//   - FaucetERC20 (below) — once per render
// -----------------------------------------------------------

const deriveFlow = (deployments, walletStep, chainId) => {
  const currentDeployment = deployments.find((d) => d.chain_id === chainId) ?? null;
  const onTokenChain = deployments.length === 0 || currentDeployment !== null;

  const gasKnown = deployments.some((d) => hasEnoughGas(d) != null);
  const hasGasSomewhere = deployments.some((d) => hasEnoughGas(d) === true);

  const activeStep =
    walletStep < 2 ? walletStep
    : !onTokenChain ? 2
    : (!gasKnown || hasGasSomewhere) ? 4
    : 3;

  const switchTarget = currentDeployment
    ?? deployments.find((d) => hasEnoughGas(d) === true)
    ?? deployments[0]
    ?? null;

  const gaslessDeployments = deployments.filter((d) => hasEnoughGas(d) === false);

  return { activeStep, switchTarget, gaslessDeployments };
};







// -----------------------------------------------------------
// watchTokenInMetamask
// -----------------------------------------------------------
//
// The wallet_watchAsset conversation: ask MetaMask to import
// the token's contract so the balance becomes VISIBLE —
// freshly received ERC-20s don't show until imported, which
// trips up students every single time. The caller switches
// chains first and routes the errors.
//
// Used by:
//   - useTokenActions (below) — showInMetamask
// -----------------------------------------------------------

async function watchTokenInMetamask(provider, deployment, token) {
  await provider.request({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: {
        address: deployment.contract_address,
        symbol: token.symbol,
        decimals: token.decimals,
      },
    },
  });
}







// -----------------------------------------------------------
// AddressRow
// -----------------------------------------------------------
//
// A full 0x… address on its own quiet grey strip: monospace,
// one line, with a copy button whose icon flips to a check
// for a moment after copying. Replaces the right-aligned
// break-all wrap that made the old cards look ragged.
//
// Used by:
//   - ChainCard (below) — the token's contract address
// -----------------------------------------------------------

function AddressRow({ value }) {

  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the address is still selectable */
    }
  };

  return (
    <div className="mt-1 flex items-center gap-1 rounded bg-gray-100 py-0.5 pl-2 pr-1">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700">{value}</span>
      <Tooltip title={copied ? 'Nukopijuota!' : 'Kopijuoti adresą'}>
        <IconButton size="small" onClick={copy} sx={{ color: copied ? 'success.main' : 'action.active' }}>
          {copied ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Tooltip>
    </div>
  );
}







// -----------------------------------------------------------
// GateCard
// -----------------------------------------------------------
//
// The wallet-flow card: install → connect → token network →
// gas → claim. The gate button covers the first three steps
// (being on ANY of the token's chains completes the network
// step); the connected-wallet line and the untagged gate
// alerts live here too, with the gate that caused them.
//
// Used by:
//   - FaucetERC20 (below)
// -----------------------------------------------------------

function GateCard({ activeStep, token, switchTarget, wallet, alerts, onError }) {
  return (
    <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
      <WalletStepper
        activeStep={activeStep}
        steps={[
          'Susidiegti Metamask',
          'Prijungti Metamask',
          switchTarget ? `Įsijungti ${switchTarget.full_name} Tinklą` : 'Įsijungti Tinklą',
          'Gauti native valiutos',
          `Atsisiųsti ${token.name} žetoną`,
        ]}
        icons={{ 3: <LocalGasStationIcon /> }}
      />

      {activeStep < 3 && (
        <div className="mt-4">
          <WalletGateButton
            step={activeStep}
            networkInfo={switchTarget}
            onConnect={wallet.connect}
            onSwitch={wallet.switchNetwork}
            onError={onError}
          />
        </div>
      )}

      {wallet.step === 3 && (
        <p className="mt-3 text-center text-xs text-gray-500">
          Prijungta piniginė: <span className="font-mono">{wallet.account}</span>
        </p>
      )}

      {alerts.map((a) => (
        <FadingAlert key={a.id} severity={a.severity}>
          {a.message}
        </FadingAlert>
      ))}
    </div>
  );
}







// -----------------------------------------------------------
// GasNoticeCard
// -----------------------------------------------------------
//
// The "get native crypto first" card, sitting on its own
// between the stepper and the chain cards: receiving tokens
// is free, but USING them needs gas, so every chain where the
// connected wallet is below the backend's threshold gets a
// row here — identity dot, a link to that chain's native
// faucet, and the required minimum. Rendered only while the
// stepper actually sits on the GAS step — earlier steps have
// their own instructions, and a flow already past it doesn't
// need the nag.
//
// Used by:
//   - FaucetERC20 (below)
// -----------------------------------------------------------

function GasNoticeCard({ gasless }) {
  return (
    <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] border-l-4 border-amber-500 p-4">
      <div className="flex items-start gap-3">
        <LocalGasStationIcon sx={{ color: '#b45309' }} />

        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-800">Trūksta native kriptovaliutos</p>
          <p className="mt-1 text-sm text-gray-700">
            Žetonų gavimas nieko nekainuoja, bet norint juos panaudoti
            reikės native kriptovaliutos tinklo mokesčiams. Pirmiausia
            jos pasiimkite:
          </p>

          <ul className="mt-2 space-y-1">
            {gasless.map((deployment) => (
              <li key={deployment.network} className="flex items-center gap-2 text-sm">
                <AssetIcon assetKey={deployment.network} icon={deployment.icon} size={14} />
                <Link
                  to={`/faucet/evm/${deployment.network}`}
                  className="font-medium text-[#78003F] underline"
                >
                  {deployment.full_name} faucet&apos;as
                </Link>
                <span className="text-gray-500">
                  — reikia bent {Number(deployment.min_native_wei) / 1e18} {deployment.native_currency?.symbol || 'ETH'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// ChainCard
// -----------------------------------------------------------
//
// One chain the token lives on: the network's identity dot
// (same colour as in the navbar picker) and name, a chip when
// the wallet is already there, the two balance rows, the
// contract address strip, and the action row — "Rodyti
// MetaMask" (switch + import, so the tokens become visible)
// beside the claim button. The card renders its OWN outcome
// alerts, passed in already filtered by network, so results
// appear right where the student clicked.
//
// needsGas (the wallet holds less than the backend's
// min_native_wei — half the native chunk — on this chain)
// only disables the claim — the explanation and the native
// faucet link live in GasNoticeCard, above the card list.
//
// Used by:
//   - FaucetERC20 (below) — one per deployment
// -----------------------------------------------------------

function ChainCard({ deployment, token, isCurrentChain, walletReady, needsGas, busy, alerts, onClaim, onShowInMetamask }) {
  return (
    <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">

      <div className="mb-3 flex items-center gap-2">
        <AssetIcon assetKey={deployment.network} icon={deployment.icon} size={18} />
        <span className="text-lg font-bold text-[#78003F]">{deployment.full_name}</span>
        <span className="flex-1" />
        {isCurrentChain && (
          <Chip size="small" color="primary" label="piniginėje" sx={{ height: 20, fontSize: 11 }} />
        )}
      </div>

      <div className="my-2 flex">
        <span className="flex-1">Išsiųsime jums:</span>
        <span className="text-right font-medium">{token.chunk_size} {token.symbol}</span>
      </div>
      <div className="my-2 flex">
        <span className="flex-1">Čiaupo balansas:</span>
        <span className="text-right">
          {deployment.balance == null ? '—' : `${deployment.balance.toFixed(3)} ${token.symbol}`}
        </span>
      </div>

      <div className="my-2">
        <span>Žetono adresas:</span>
        <AddressRow value={deployment.contract_address} />
      </div>

      <div className="mt-3 flex gap-2">
        <Tooltip title="Persijungti į šį tinklą ir parodyti žetoną MetaMask sąraše">
          <Button
            variant="outlined"
            startIcon={<VisibilityIcon />}
            onClick={() => onShowInMetamask(deployment)}
            sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            Rodyti MetaMask
          </Button>
        </Tooltip>

        <Button
          variant="contained"
          fullWidth
          disabled={!walletReady || needsGas || busy !== null}
          onClick={() => onClaim(deployment)}
          sx={{ minHeight: 40 }}
        >
          {busy === deployment.network
            ? <CircularProgress size={22} color="inherit" />
            : `Gauti ${token.symbol}`}
        </Button>
      </div>

      {alerts.map((a) => (
        <FadingAlert key={a.id} severity={a.severity}>
          {a.message}
        </FadingAlert>
      ))}

    </div>
  );
}







// -----------------------------------------------------------
// ReturnAddressCard
// -----------------------------------------------------------
//
// The bottom card every faucet page has: the faucet's address
// as text + QR, so leftover tokens can be sent back. One
// address covers every chain — the faucet wallet is the same
// everywhere.
//
// Used by:
//   - FaucetERC20 (below)
// -----------------------------------------------------------

function ReturnAddressCard({ address, symbol }) {
  return (
    <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[640px] p-4">
      <div className="my-2 flex items-start gap-4">
        <span className="flex-1">
          Grąžinkite nebereikalingus <u><b>{symbol}</b></u> žetonus atgal:
          <br /><br />{address}
        </span>
        <QRCode value={address} size={128} />
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// LoadingSkeleton
// -----------------------------------------------------------
//
// The page as grey bones — title, stepper, one chain-card
// shape with its action row, and the QR card — shown until
// the token payload arrives.
//
// Used by:
//   - FaucetERC20 (below)
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
          <Skeleton variant="text" height={28} width="50%" />
          <Skeleton variant="text" height={28} />
          <Skeleton variant="text" height={28} />
          <Stack direction="row" spacing={2}>
            <Skeleton variant="rectangular" height={40} width={170} />
            <Skeleton variant="rectangular" height={40} sx={{ flex: 1 }} />
          </Stack>
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
// useTokenActions
// -----------------------------------------------------------
//
//   const { busy, claim, showInMetamask } =
//     useTokenActions(symbol, wallet, data, addAlert, reload)
//
// What the buttons DO — the action side of the page, kept
// apart from the layout. claim signs the ownership message
// and asks the backend to send on ONE chain; showInMetamask
// hops the wallet there and imports the contract. busy names
// the network with a claim in flight — every claim button
// disables while any one is. Outcomes become alerts tagged
// with the chain's network, so they render inside the card
// whose button was pressed.
//
// Used by:
//   - FaucetERC20 (below)
// -----------------------------------------------------------

function useTokenActions(symbol, wallet, data, addAlert, reload) {

  const [busy, setBusy] = useState(null);


  // Claim on ONE chain. The wallet's current chain doesn't
  // matter — the backend sends on the chain named in the URL,
  // the signature only proves who is asking.
  const claim = async (deployment) => {
    setBusy(deployment.network);
    try {
      const { nonce, signature } = await wallet.signMessage();

      await axios.get(`/api/erc20/${deployment.network}/${symbol}/request`, {
        params: { address: wallet.account, signature, nonce },
      });

      addAlert(
        'success',
        `${data.token.chunk_size} ${symbol} išsiųsta! Jei piniginėje jų nesimato — spauskite „Rodyti MetaMask“.`,
        deployment.network,
      );
      reload();
    } catch (e) {
      // Backend refusals arrive as { error } in the response
      // body; wallet errors (sign refused, not connected) only
      // carry a message
      addAlert('error', e.response?.data?.error || e.message || 'Nepavyko išsiųsti žetonų.', deployment.network);
    } finally {
      setBusy(null);
    }
  };


  // Make the token visible: hop to that chain if the wallet is
  // elsewhere, then import the contract address so MetaMask
  // stops pretending the balance isn't there. MetaMask's OWN
  // provider — bare window.ethereum may be another wallet
  const showInMetamask = async (deployment) => {
    const provider = getMetamaskProvider();
    if (!provider) {
      addAlert('error', 'Pirmiausia įsidiekite MetaMask.', deployment.network);
      return;
    }

    try {
      if (wallet.chainId !== deployment.chain_id) {
        await wallet.switchNetwork(deployment);
      }
      await watchTokenInMetamask(provider, deployment, data.token);
    } catch (e) {
      addAlert('error', e.message || 'Nepavyko pridėti žetono į MetaMask.', deployment.network);
    }
  };


  return { busy, claim, showInMetamask };
}







// -----------------------------------------------------------
// FaucetERC20 (default export)
// -----------------------------------------------------------
//
// The page itself: state and layout — GateCard, then one
// card per chain. The five-step ladder is deriveFlow's
// business, the button handlers are useTokenActions';
// useMetamaskWallet gets no expected chain (the token spans
// many), and until the wallet sits on a token chain the gate
// button SWITCHES it for the student — same
// wallet_switchEthereumChain mechanics as the EVM page.
// Claim buttons enable only at the final step. Alerts are
// tagged by network so each chain card shows only its own
// outcomes; untagged rows (gate errors) render inside
// GateCard.
//
// Used by:
//   - App.jsx — route /faucet/erc20/:token
// -----------------------------------------------------------

export default function FaucetERC20() {

  const { token: symbol } = useParams();

  const wallet = useMetamaskWallet();
  const { data, error, reload } = useToken(symbol, wallet.account);
  const { alerts, addAlert } = useAlerts();
  const { busy, claim, showInMetamask } = useTokenActions(symbol, wallet, data, addAlert, reload);

  const gateAlerts = alerts.filter((a) => !a.tag);
  const alertsFor = (network) => alerts.filter((a) => a.tag === network);


  if (error) {
    return <ErrorCard>{error}</ErrorCard>;
  }

  if (!data) {
    return <LoadingSkeleton />;
  }

  const { token, deployments } = data;

  // The five-step ladder, the switch target and the gasless
  // list — all deriveFlow's business (see its banner)
  const { activeStep, switchTarget, gaslessDeployments } =
    deriveFlow(deployments, wallet.step, wallet.chainId);


  return (
    <Box className="p-4">

      {/* Title — the token's identity dot matches its dot in
          the navbar picker */}
      <div className="mx-auto w-full min-w-[320px] max-w-[640px] px-4 pt-4">
        <h1 className="mb-3 text-center text-[45px] font-bold text-[#78003F]">
          <AssetIcon assetKey={symbol} icon={token.icon} size={40} inline />
          {token.name} faucet&apos;as
        </h1>
        <p className="text-sm text-gray-700">
          Šiuo įrankiu galite gauti <u>{token.symbol}</u> ERC-20 testinių žetonų laboratoriniams darbams.
          Tas pats žetonas veikia keliuose tinkluose — pasirinkite, kuriame jo norite.
        </p>
      </div>

      <GateCard
        activeStep={activeStep}
        token={token}
        switchTarget={switchTarget}
        wallet={wallet}
        alerts={gateAlerts}
        onError={(msg) => addAlert('error', msg)}
      />

      {/* The notice card shows ONLY while the flow sits on the
          gas step — earlier steps have their own instructions,
          and once any chain clears the bar the remaining
          gasless ones just keep their claim buttons disabled */}
      {activeStep === 3 && gaslessDeployments.length > 0 && (
        <GasNoticeCard gasless={gaslessDeployments} />
      )}

      {/* One card per chain the token lives on. An unknown
          native balance (RPC unreachable) fails OPEN — the
          backend still enforces the gas rule. */}
      {deployments.length === 0 ? (
        <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
          <p className="text-sm text-gray-700">
            Šis žetonas kol kas nėra įdiegtas jokiame tinkle.
          </p>
        </div>
      ) : (
        deployments.map((deployment) => (
          <ChainCard
            key={deployment.network}
            deployment={deployment}
            token={token}
            isCurrentChain={wallet.chainId === deployment.chain_id}
            walletReady={activeStep === 4}
            needsGas={hasEnoughGas(deployment) === false}
            busy={busy}
            alerts={alertsFor(deployment.network)}
            onClaim={claim}
            onShowInMetamask={showInMetamask}
          />
        ))
      )}

      <ReturnAddressCard address={data.faucet_address} symbol={token.symbol} />

    </Box>
  );
}
