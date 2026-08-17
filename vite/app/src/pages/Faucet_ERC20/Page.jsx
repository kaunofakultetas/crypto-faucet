// -----------------------------------------------------------
//  [*] Pages — ERC-20 Faucet (route /faucet/erc20/:token)
//
//  The student-facing faucet for ERC-20 TEST TOKENS, keyed by
//  the TOKEN — "I need LINK" comes before "on which chain".
//  The page shows one token and every chain it is deployed
//  on: GET /api/erc20/token/<symbol> returns the faucet's
//  balance per chain plus the metadata MetaMask needs.
//
//  Laid out like the native faucet — title, the MetaMask
//  stepper, then the chain cards, then the return address with
//  a QR code. Each chain card carries the network's identity
//  dot (the SAME colour the navbar picker shows for it), the
//  balance rows, the contract address with a copy button, and
//  the claim button. Claim outcomes render INSIDE the card
//  that caused them (alerts tagged by network), so the student
//  sees the result next to the button they pressed — gate
//  errors (connect/install) stay under the stepper.
//
//  Claiming technically does not require the wallet to sit
//  on the TARGET chain — the signature only proves address
//  ownership — but the flow still demands the wallet be on
//  ONE of the token's chains before any claim: a student
//  parked on some unrelated network would not see the tokens
//  land and would assume the faucet is broken. Seeing them
//  ALSO takes an import, so every card has a "Rodyti
//  MetaMask" button that switches the wallet and imports the
//  token (wallet_watchAsset) — freshly received ERC-20s are
//  invisible until imported, which trips up students every
//  single time.
//
//  Receiving tokens costs the student nothing (the faucet
//  pays the gas), but USING them does — so the stepper has a
//  dedicated GAS step, and every chain gates its claim on the
//  wallet holding at least HALF the native faucet's chunk
//  there. BOTH numbers come from the backend in the token
//  payload (min_native_wei + wallet_native_wei, fetched over
//  its own RPC connections — the public rpc_urls are not
//  reliable from a browser), so the page and the backend gate
//  on the same data. Chains below the bar disable their claim
//  buttons, and ONE dedicated GasNoticeCard between the
//  stepper and the chain cards lists them with links to their
//  native faucets (/faucet/evm/<network>); the backend
//  enforces the same rule, so bypassing the button changes
//  nothing.
//
//  Split into (root component last):
//
//    TOKEN_REFRESH_MS  — token payload repoll cadence
//    useToken          — the token + its deployments, polled
//    AddressRow        — mono address + copy button
//    GasNoticeCard     — the "get native crypto first" card
//    ChainCard         — one chain: dot, balances, claim,
//                        show-in-MetaMask, its own alerts
//    ReturnAddressCard — send leftover tokens back (+ QR)
//    LoadingSkeleton   — full-page skeleton layout
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

import useMetamaskWallet from '@/hooks/useMetamaskWallet';
import { WalletStepper, WalletGateButton, FadingAlert, useAlerts } from '@/components/WalletFlow';
import AssetIcon from '@/components/AssetIcon';


// How often the token payload (with the faucet's per-chain
// balances) repolls — the backend caches those ~10 s anyway
const TOKEN_REFRESH_MS = 15000;







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
// balance (wallet_native_wei) — the gas gate's input. A token
// switch changes the key and shows skeletons; an account
// change keeps the current rows on screen while the refresh
// lands (placeholderData, same-symbol only). error holds the
// backend's message for an unknown token; reload() (after a
// claim) invalidates the query for an immediate refetch.
//
// Used by:
//   - FaucetERC20 (below)
// -----------------------------------------------------------

function useToken(symbol, account) {

  const queryClient = useQueryClient();

  const { data = null, error: queryError } = useQuery({
    queryKey: ['erc20-token', symbol, account ?? null],
    refetchInterval: TOKEN_REFRESH_MS,
    queryFn: async () => {
      const suffix = account ? `?address=${account}` : '';
      return (await axios.get(`/api/erc20/token/${symbol}${suffix}`)).data;
    },
    // Keep the previous payload only across an ACCOUNT change —
    // a different token must show skeletons, never stale rows
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[1] === symbol ? previousData : undefined,
  });

  const error = queryError
    ? (queryError.response?.data?.error || 'Nepavyko gauti žetono informacijos')
    : null;

  const reload = () => queryClient.invalidateQueries({ queryKey: ['erc20-token', symbol] });

  return { data, error, reload };
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
    } catch (_) {
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
// FaucetERC20 (default export)
// -----------------------------------------------------------
//
// The page itself: the wallet flow around one card per chain.
// useMetamaskWallet gets no expected chain (the token spans
// many), so
// activeStep is derived HERE — five steps: install → connect
// → switch to a token network (an unrelated chain would hide
// the received tokens) → have gas → claim. The network step
// is done once the wallet sits on ANY of the token's chains;
// its button targets the current chain's deployment when
// there is one, else the first chain with gas, else the
// first. The gas step completes once the wallet clears the
// threshold (half the native chunk) on at least one chain.
// Claim buttons enable only at the final step. Alerts are
// tagged by network so each chain card shows only its own
// outcomes; untagged rows (gate errors) render under the
// stepper.
//
// Used by:
//   - App.jsx — route /faucet/erc20/:token
// -----------------------------------------------------------

export default function FaucetERC20() {

  const { token: symbol } = useParams();

  const wallet = useMetamaskWallet();
  const { data, error, reload } = useToken(symbol, wallet.account);
  const { alerts, addAlert } = useAlerts();

  const [busy, setBusy] = useState(null);

  const gateAlerts = alerts.filter((a) => !a.tag);
  const alertsFor = (network) => alerts.filter((a) => a.tag === network);


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
  // stops pretending the balance isn't there
  const showInMetamask = async (deployment) => {
    if (!window.ethereum) {
      addAlert('error', 'Pirmiausia įsidiekite MetaMask.', deployment.network);
      return;
    }

    try {
      if (wallet.chainId !== deployment.chain_id) {
        await wallet.switchNetwork(deployment);
      }

      await window.ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: deployment.contract_address,
            symbol: data.token.symbol,
            decimals: data.token.decimals,
          },
        },
      });
    } catch (e) {
      addAlert('error', e.message || 'Nepavyko pridėti žetono į MetaMask.', deployment.network);
    }
  };


  if (error) {
    return (
      <Box className="p-4">
        <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
          <p className="text-center text-red-600">{error}</p>
        </div>
      </Box>
    );
  }

  if (!data) {
    return <LoadingSkeleton />;
  }

  const { token, deployments } = data;


  // Does the wallet hold the backend's min_native_wei (half
  // the native chunk) on this chain? Both numbers arrive in
  // the deployment itself. true / false / null when the
  // balance is unknown (not connected yet, RPC hiccup).
  const hasEnoughGas = (deployment) => {
    const bal = deployment.wallet_native_wei;
    if (bal == null) return null;
    return BigInt(bal) >= BigInt(deployment.min_native_wei ?? 0);
  };


  // The page's own steps on top of useMetamaskWallet's 0/1 (install /
  // connect): the NETWORK step — the wallet must sit on ONE
  // of the token's chains, an unrelated chain would hide the
  // received tokens — then the GAS step, complete once at
  // least one chain clears the threshold. While no balance is
  // known yet the gas step counts as passed — fail open, the
  // cards and the backend still enforce the rule per chain.
  const currentDeployment = deployments.find((d) => d.chain_id === wallet.chainId) ?? null;
  const onTokenChain = deployments.length === 0 || currentDeployment !== null;

  const gasKnown = deployments.some((d) => hasEnoughGas(d) != null);
  const hasGasSomewhere = deployments.some((d) => hasEnoughGas(d) === true);

  const activeStep =
    wallet.step < 2 ? wallet.step
    : !onTokenChain ? 2
    : (!gasKnown || hasGasSomewhere) ? 4
    : 3;

  // Where the network step's button switches to: the chain
  // the wallet already sits on when it's a token chain, else
  // the first chain with gas, else simply the first
  const switchTarget = currentDeployment ?? deployments.find((d) => hasEnoughGas(d) === true) ?? deployments[0] ?? null;

  // The chains GasNoticeCard lists — below the bar for sure,
  // not merely unknown
  const gaslessDeployments = deployments.filter((d) => hasEnoughGas(d) === false);


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

      {/* Install → connect → token network → gas → claim. The
          gate covers the first three; being on ANY of the
          token's chains completes the network step. Gate
          errors and the connected-wallet line live here, with
          the gate. */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
        <WalletStepper
          activeStep={activeStep}
          steps={[
            'Susidiegti Metamask',
            'Prijungti Metamask',
            switchTarget ? `Įsijungti ${switchTarget.full_name} Tinklą` : 'Įsijungti Tinklą',
            'Gauti native valiutos',
            `Atsisiųsti ${token.symbol}`,
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
              onError={(msg) => addAlert('error', msg)}
            />
          </div>
        )}

        {wallet.step === 3 && (
          <p className="mt-3 text-center text-xs text-gray-500">
            Prijungta piniginė: <span className="font-mono">{wallet.account}</span>
          </p>
        )}

        {gateAlerts.map((a) => (
          <FadingAlert key={a.id} severity={a.severity}>
            {a.message}
          </FadingAlert>
        ))}
      </div>

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
