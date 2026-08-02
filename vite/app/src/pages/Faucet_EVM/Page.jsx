// -----------------------------------------------------------
//  [*] Pages — EVM Faucet (route /faucet/evm/:network)
//
//  The student-facing faucet for NATIVE EVM coins (Sepolia
//  ETH and friends). ERC-20 tokens live on their own page:
//  /faucet/erc20/:network.
//
//  The four-step MetaMask flow (install → connect → switch
//  network → claim) is driven by the shared useWallet hook;
//  claiming signs a nonce message the backend verifies before
//  sending (GET /api/evm/<network>/request). The faucet's
//  return address renders as text + QR, with a shortcut to
//  the transaction graph (/graph/<network>).
//
//  Network metadata (chain id, names, RPC urls) comes from
//  /api/evm/networks and also feeds MetaMask's
//  wallet_addEthereumChain when the chain is missing there.
//  The page shows skeletons until both the metadata and the
//  faucet info have arrived.
//
//  Split into (root component last):
//
//    FAUCET_REFRESH_MS — faucet balance repoll cadence
//    useFaucetInfo     — network metadata + faucet polling
//    LoadingSkeleton   — full-page skeleton layout
//    FaucetEVM         — page state + layout (default export)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QRCode from 'react-qr-code';
import axios from 'axios';

import { Button, Box, Skeleton, Stack, CircularProgress } from '@mui/material';
import HubIcon from '@mui/icons-material/Hub';

import useWallet from '../../hooks/useWallet';
import { MetamaskStepper, WalletGateButton, FadingAlert, useAlerts } from '../../components/WalletFlow';


// How often the faucet balance repolls
const FAUCET_REFRESH_MS = 3000;







// -----------------------------------------------------------
// useFaucetInfo
// -----------------------------------------------------------
//
//   const { networkInfo, faucetInfo } = useFaucetInfo(network)
//
// The backend side of the page: the network's metadata
// (chain id, names, RPC urls — from /api/evm/networks) and
// the faucet info ({ address, balance, chunk_size }), which
// starts polling every 3 s once the metadata is in. Both
// reset on a network switch, so the previous chain's numbers
// never linger. Failures only log — the page keeps its
// skeletons until data arrives.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function useFaucetInfo(network) {

  const [networkInfo, setNetworkInfo] = useState(null);
  const [faucetInfo, setFaucetInfo] = useState(null);


  useEffect(() => {
    let ignore = false;

    setNetworkInfo(null);
    setFaucetInfo(null);

    axios.get('/api/evm/networks')
      .then(({ data }) => {
        if (!ignore) setNetworkInfo(data.networks?.[network]);
      })
      .catch((err) => console.error('Unable to load network list', err));

    return () => { ignore = true; };
  }, [network]);


  // Faucet info + 3 s repoll, once we know the network exists
  useEffect(() => {
    if (!networkInfo) return;

    let ignore = false;

    const load = async () => {
      try {
        const { data } = await axios.get(`/api/evm/${network}/faucet-balance`);
        if (!ignore) setFaucetInfo(data);
      } catch (err) {
        console.error('Unable to load faucet info', err);
      }
    };

    load();
    const id = setInterval(load, FAUCET_REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [networkInfo, network]);


  return { networkInfo, faucetInfo };
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
      <div className="mx-auto w-full min-w-[320px] max-w-[560px] px-4 pt-4">
        <Skeleton variant="text" height={48} width="70%" />
        <Skeleton variant="text" height={20} width="90%" />
      </div>

      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
        <Skeleton variant="rectangular" height={60} />
      </div>

      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
        <Stack spacing={2}>
          <Skeleton variant="text" height={28} />
          <Skeleton variant="text" height={28} />
          <Skeleton variant="text" height={28} />
          <Skeleton variant="rectangular" height={40} />
        </Stack>
      </div>

      <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
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

  const { networkInfo, faucetInfo } = useFaucetInfo(network);
  const wallet = useWallet(networkInfo?.chain_id);
  const { alerts, addAlert } = useAlerts();

  const [claiming, setClaiming] = useState(false);


  // Sign the ownership message and let the backend verify it
  // before paying out — no transaction on the student's side
  const claimNative = async () => {
    setClaiming(true);
    try {
      const { nonce, signature } = await wallet.signMessage();

      const params = new URLSearchParams({ address: wallet.account, signature, nonce });
      const res = await fetch(`/api/evm/${network}/request?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Nepavyko išsiųsti ${network} ETH`);

      addAlert('success', `${networkInfo.full_name} išsiųstas į jūsų piniginę.`);
    } catch (e) {
      addAlert('error', e.message || 'Nepavyko išsiųsti kriptovaliutos.');
    } finally {
      setClaiming(false);
    }
  };


  if (!networkInfo || !faucetInfo) {
    return <LoadingSkeleton />;
  }

  const faucetAddress = faucetInfo.address.toLowerCase();

  const formatBalance = (bal) => {
    if (bal == null) return 'Loading…';
    if (!wallet.web3) return '-';
    return `${parseFloat(wallet.web3.utils.fromWei(bal, 'ether')).toFixed(3)} ${networkInfo.short_name}`;
  };


  return (
    <Box className="p-4">

      {/* Title */}
      <div className="mx-auto w-full min-w-[320px] max-w-[560px] px-4 pt-4">
        <h1 className="mb-3 text-[45px] font-bold text-[#78003F]">
          {networkInfo.full_name} ETH faucet&apos;as
        </h1>
        <p className="text-sm text-gray-700">
          Šiuo įrankiu galite gauti <u>{networkInfo.full_name}</u> ETH testinės kriptovaliutos laboratoriniams darbams.
        </p>
      </div>

      {/* The four-step MetaMask flow */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
        <MetamaskStepper
          activeStep={wallet.step}
          steps={[
            'Susidiegti Metamask',
            'Prijungti Metamask',
            `Įsijungti ${networkInfo.full_name} Tinklą`,
            `Atsisiųsti ${networkInfo.full_name} ETH`,
          ]}
        />
      </div>

      {/* Balances, the claim button and its outcome alerts */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">

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
                : `Gauti ${networkInfo.full_name} ETH valiutos`}
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
      <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
        <div className="my-2 flex items-start gap-4">
          <span className="flex-1">
            Grąžinkite nebereikalingą <u><b>{networkInfo.short_name}</b></u> krypto atgal:
            <br /><br />{faucetAddress}
            <br /><br />
            <Button
              variant="contained"
              onClick={() => navigate(`/graph/${network}`)}
              startIcon={<HubIcon />}
              sx={{ padding: '10px 16px' }}
            >
              Transakcijų srautas
            </Button>
          </span>
          <QRCode value={faucetAddress} size={128} />
        </div>
      </div>

    </Box>
  );
}
