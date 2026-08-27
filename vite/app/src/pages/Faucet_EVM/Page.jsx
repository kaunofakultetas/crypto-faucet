// -----------------------------------------------------------
//  [*] Pages — EVM Faucet (route /faucet/evm/:network)
//
//  The student-facing faucet for NATIVE EVM coins (Sepolia
//  ETH and friends). ERC-20 tokens live on their own page:
//  /faucet/erc20/:network.
//
//  The four-step MetaMask flow (install → connect → switch
//  network → claim) is driven by the shared useMetamaskWallet
//  hook;
//  claiming signs a nonce message the backend verifies before
//  sending (GET /api/evm/<network>/request). The faucet's
//  return address renders as text + QR, with a shortcut to
//  the transaction graph (/graph/<network>).
//
//  Network metadata (chain id, names, RPC urls) comes from
//  /api/evm/networks and also feeds MetaMask's
//  wallet_addEthereumChain when the chain is missing there.
//  The page shows skeletons until both the metadata and the
//  faucet info have arrived; a catalog that failed, or a
//  :network the catalog does not know, gets an error card
//  instead of skeletons forever.
//
//  Split into (root component last):
//
//    FAUCET_REFRESH_MS — faucet balance repoll cadence
//    useFaucetInfo     — network metadata + faucet polling
//    LoadingSkeleton   — full-page skeleton layout
//    FaucetEVM         — page state + layout (default export)
// -----------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-qr-code';
import axios from 'axios';

import { Button, Box, Skeleton, Stack, CircularProgress } from '@mui/material';
import HubIcon from '@mui/icons-material/Hub';

import useMetamaskWallet from '@/hooks/useMetamaskWallet';
import { WalletStepper, WalletGateButton, FadingAlert, useAlerts } from '@/components/WalletFlow';
import AssetIcon from '@/components/AssetIcon';
import ErrorCard from '@/components/ErrorCard';


// How often the faucet balance repolls
const FAUCET_REFRESH_MS = 3000;







// -----------------------------------------------------------
// useFaucetInfo
// -----------------------------------------------------------
//
//   const { networkInfo, faucetInfo, catalogFailed,
//           unknownNetwork } = useFaucetInfo(network)
//
// The backend side of the page as two TanStack queries: the
// network's metadata (chain id, names, RPC urls — from
// /api/evm/networks, cache shared with the graph page; the
// navbar reads the bundled /api/faucet/catalog instead) and
// the faucet info ({ address, balance, chunk_size }),
// polling every 3 s once the metadata is in.
// A network switch changes the query keys, so the previous
// chain's numbers never linger. A failed faucet poll keeps
// the last payload; a catalog that never arrived
// (catalogFailed) and a :network the catalog does not know
// (unknownNetwork) are reported apart, so the page can say
// so instead of showing skeletons forever.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function useFaucetInfo(network) {

  const { data: networksData, isError: catalogError } = useQuery({
    queryKey: ['evm-networks'],
    queryFn: async () => (await axios.get('/api/evm/networks')).data,
    staleTime: 5 * 60 * 1000,
  });
  const networks = networksData?.networks ?? null;
  const networkInfo = networks?.[network] ?? null;
  const catalogFailed = catalogError && !networks;
  const unknownNetwork = Boolean(networks) && !networkInfo;

  const { data: faucetInfo = null } = useQuery({
    queryKey: ['evm-faucet-balance', network],
    queryFn: async () => (await axios.get(`/api/evm/${network}/faucet-balance`)).data,
    enabled: Boolean(networkInfo),
    refetchInterval: FAUCET_REFRESH_MS,
  });

  return { networkInfo, faucetInfo, catalogFailed, unknownNetwork };
}







// -----------------------------------------------------------
// LoadingSkeleton
// -----------------------------------------------------------
//
// The whole page as grey bones — same four cards, shown until
// both the network metadata and the faucet info have arrived.
//
// Used by:
//   - FaucetEVM (below)
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
// FaucetEVM (default export)
// -----------------------------------------------------------
//
// The page itself: wires the wallet and faucet hooks into the
// stepper, the balance rows, the claim button and the alerts.
//
// Used by:
//   - App.jsx — route /faucet/evm/:network
// -----------------------------------------------------------

export default function FaucetEVM() {

  const { network } = useParams();
  const navigate = useNavigate();

  const { networkInfo, faucetInfo, catalogFailed, unknownNetwork } = useFaucetInfo(network);
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
  // poll. An answer that arrives after a network switch is
  // dropped: it belongs to the chain it was issued for.
  const claimNative = async () => {
    const forNetwork = network;
    setClaimingFor(forNetwork);
    try {
      const { nonce, signature } = await wallet.signMessage();

      await axios.get(`/api/evm/${forNetwork}/request`, {
        params: { address: wallet.account, signature, nonce },
      });

      queryClient.invalidateQueries({ queryKey: ['evm-faucet-balance', forNetwork] });
      if (networkRef.current !== forNetwork) return;
      addAlert('success', `${networkInfo.full_name} išsiųstas į jūsų piniginę.`);
    } catch (e) {
      // Backend refusals arrive as { error } in the response
      // body; wallet errors (sign refused, not connected) only
      // carry a message
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

  const faucetAddress = faucetInfo.address.toLowerCase();

  // Three states that must not blur: no wallet or a dead RPC
  // is a dash, a poll still in flight is "Loading…". The
  // balance is a BigInt of wei — divided down to micro-ether
  // as an integer first, so the float never sees 18 digits.
  const formatBalance = (wei) => {
    if (!wallet.installed || wallet.balanceFailed) return '-';
    if (wei == null) return 'Loading…';
    const microEther = Number(wei / 1_000_000_000_000n);
    return `${(microEther / 1e6).toFixed(3)} ${networkInfo.short_name}`;
  };


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
            'Susidiegti Metamask',
            'Prijungti Metamask',
            `Įsijungti ${networkInfo.full_name} Tinklą`,
            `Atsisiųsti ${networkInfo.full_name}`,
          ]}
        />
      </div>

      {/* Balances, the claim button and its outcome alerts */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">

        <div className="my-2 flex">
          <span className="flex-1">Jūsų Metamask balansas:</span>
          <span className="text-right">{wallet.step === 3 ? formatBalance(wallet.balance) : 'Piniginė neprijungta'}</span>
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
              disabled={claiming}
              onClick={claimNative}
              sx={{ minHeight: 40 }}
            >
              {claiming
                ? <CircularProgress size={22} color="inherit" />
                : `Gauti ${networkInfo.full_name} valiutos`}
            </Button>
          )}
        </div>

        {alerts.map((a) => (
          <FadingAlert key={a.id} severity={a.severity}>
            {a.message}
          </FadingAlert>
        ))}
      </div>

      {/* Return address + the transaction graph shortcut */}
      <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[640px] p-4">
        <div className="my-2 flex items-start gap-4">
          <span className="flex-1">
            Grąžinkite nebereikalingą <u><b>{networkInfo.short_name}</b></u> krypto atgal:
            <br /><br />{faucetAddress}
            {/* The graph needs an explorer behind it — a chain
                without one gets no button rather than an empty
                graph */}
            {networkInfo.has_explorer !== false && (
              <>
                <br /><br />
                <Button
                  variant="contained"
                  onClick={() => navigate(`/graph/${network}`)}
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

    </Box>
  );
}
