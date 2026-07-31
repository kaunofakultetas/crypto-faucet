// -----------------------------------------------------------
//  [*] Pages — EVM Faucet (route /faucet/evm/:network)
//
//  The student-facing faucet for EVM chains: a four-step
//  Metamask flow (install → connect → switch network → claim)
//  driven by ONE derived activeStep, live balances (the
//  user's wallet every 1 s, the faucet every 3 s) and the
//  claim itself — the student signs a nonce message and the
//  backend verifies the signature before sending
//  (GET /api/evm/<network>/request-eth). The faucet's return
//  address renders as text + QR, with a shortcut to the
//  transaction graph (/graph/<network>).
//
//  Network metadata (chain id, names, RPC urls) comes from
//  /api/evm/networks; it also feeds Metamask's
//  wallet_addEthereumChain when the chain is missing there.
//  The page shows skeletons until both the metadata and the
//  faucet info have arrived.
//
//  Split into (root component last):
//
//    FAUCET_REFRESH_MS    — faucet balance repoll cadence
//    WALLET_REFRESH_MS    — Metamask balance repoll cadence
//    ALERT_VISIBLE_MS/…   — alert lifetime + fade length
//    ColorlibConnector    — gradient connector line (styled)
//    ColorlibStepIconRoot — gradient step bubble (styled)
//    useWallet            — Metamask: web3, account, chain,
//                           balance, connect
//    useFaucetInfo        — network metadata + faucet polling
//    FadingAlert          — self-fading alert row
//    ColorlibStepIcon     — icon inside a step bubble
//    ProgressStepper      — the four-step progress bar
//    ClaimButton          — install/connect/switch/claim
//    LoadingSkeleton      — full-page skeleton layout
//    FaucetEVM            — page state + layout (default
//                           export)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Web3 from 'web3';
import QRCode from 'react-qr-code';
import axios from 'axios';

import { Button, Box, Skeleton, Stack, CircularProgress, Alert as MuiAlert, Stepper, Step, StepLabel, StepConnector, stepConnectorClasses } from '@mui/material';
import { styled } from '@mui/material/styles';
import HubIcon from '@mui/icons-material/Hub';
import InstallDesktopIcon from '@mui/icons-material/InstallDesktop';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';





// How often the faucet balance repolls
const FAUCET_REFRESH_MS = 3000;

// How often the user's Metamask balance repolls — fast, so
// students see it tick up right after a claim
const WALLET_REFRESH_MS = 1000;

// Alert lifetime: fully visible, then a short fade, then the
// row is dropped from the list
const ALERT_VISIBLE_MS = 8000;
const ALERT_FADE_MS = 500;







// -----------------------------------------------------------
// ColorlibConnector
// -----------------------------------------------------------
//
// The stepper's connector line: a thin grey bar that switches
// to the brand orange→pink→purple gradient once the step it
// leads to is active or completed.
//
// Used by:
//   - ProgressStepper (below)
// -----------------------------------------------------------

const ColorlibConnector = styled(StepConnector)(({ theme }) => ({
  [`&.${stepConnectorClasses.alternativeLabel}`]: {
    top: 22,
  },
  [`&.${stepConnectorClasses.active}`]: {
    [`& .${stepConnectorClasses.line}`]: {
      backgroundImage:
        'linear-gradient( 95deg,rgb(242,113,33) 0%,rgb(233,64,87) 50%,rgb(138,35,135) 100%)',
    },
  },
  [`&.${stepConnectorClasses.completed}`]: {
    [`& .${stepConnectorClasses.line}`]: {
      backgroundImage:
        'linear-gradient( 95deg,rgb(242,113,33) 0%,rgb(233,64,87) 50%,rgb(138,35,135) 100%)',
    },
  },
  [`& .${stepConnectorClasses.line}`]: {
    height: 3,
    border: 0,
    backgroundColor:
      theme.palette.mode === 'dark' ? theme.palette.grey[800] : '#eaeaf0',
    borderRadius: 1,
  },
}));







// -----------------------------------------------------------
// ColorlibStepIconRoot
// -----------------------------------------------------------
//
// One round step bubble: grey until reached, the brand
// gradient (plus a drop shadow while active) once the step is
// active or completed — ownerState carries the two flags in.
//
// Used by:
//   - ColorlibStepIcon (below)
// -----------------------------------------------------------

const ColorlibStepIconRoot = styled('div')(({ theme, ownerState }) => ({
  backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[700] : '#ccc',
  zIndex: 1,
  color: '#fff',
  width: 50,
  height: 50,
  display: 'flex',
  borderRadius: '50%',
  justifyContent: 'center',
  alignItems: 'center',
  ...(ownerState.active && {
    backgroundImage:
      'linear-gradient( 136deg, rgb(242,113,33) 0%, rgb(233,64,87) 50%, rgb(138,35,135) 100%)',
    boxShadow: '0 4px 10px 0 rgba(0,0,0,.25)',
  }),
  ...(ownerState.completed && {
    backgroundImage:
      'linear-gradient( 136deg, rgb(242,113,33) 0%, rgb(233,64,87) 50%, rgb(138,35,135) 100%)',
  }),
}));







// -----------------------------------------------------------
// useWallet
// -----------------------------------------------------------
//
//   const { web3, installed, account, chainId, balance,
//           connect } = useWallet(expectedChainId)
//
// The single source of truth for everything Metamask: one
// Web3 instance, the active account and chain (kept fresh via
// the accountsChanged/chainChanged listeners), and the user's
// balance — repolled every second, but only while connected
// AND on the expected chain; otherwise it stays null so the
// page can say "wallet not connected" instead of showing a
// number from the wrong network. connect() opens the Metamask
// account prompt.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function useWallet(expectedChainId) {

  const [web3, setWeb3] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [balance, setBalance] = useState(null);


  // Detect Metamask once; the listeners keep account/chain in
  // step with what the student does inside the extension
  useEffect(() => {
    if (!window.ethereum) return;

    setInstalled(true);
    const w3 = new Web3(window.ethereum);
    setWeb3(w3);

    const handleAccountsChanged = (acc) => setAccount(acc[0] ?? null);
    const handleChainChanged = (id) => setChainId(parseInt(id, 16));

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    w3.eth.getAccounts().then(handleAccountsChanged);
    w3.eth.getChainId().then((id) => setChainId(Number(id)));

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, []);


  // Balance repoll — re-checks the chain on every tick because
  // the student can switch networks in Metamask at any moment
  useEffect(() => {
    if (!web3 || !account || !expectedChainId) {
      setBalance(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const currentId = await web3.eth.getChainId();
        if (cancelled) return;
        if (Number(currentId) !== Number(expectedChainId)) {
          setBalance(null);
          return;
        }
        const bal = await web3.eth.getBalance(account);
        if (!cancelled) setBalance(bal);
      } catch (err) {
        console.error('Unable to fetch user balance', err);
        if (!cancelled) setBalance(null);
      }
    };

    load();
    const id = setInterval(load, WALLET_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [web3, account, expectedChainId]);


  const connect = () =>
    window.ethereum
      .request({ method: 'eth_requestAccounts' })
      .then((acc) => {
        if (acc.length) setAccount(acc[0]);
      });


  return { web3, installed, account, chainId, balance, connect };
}







// -----------------------------------------------------------
// useFaucetInfo
// -----------------------------------------------------------
//
//   const { networkInfo, faucetInfo } = useFaucetInfo(network)
//
// The backend side of the page: the network's metadata
// (chain id, names, RPC urls — from /api/evm/networks) and
// the faucet info ({ address, balance, chunk_size }), which
// starts polling every 3 s once the metadata is in. Failures
// only log — the page keeps its skeletons until data arrives.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function useFaucetInfo(network) {

  const [networkInfo, setNetworkInfo] = useState(null);
  const [faucetInfo, setFaucetInfo] = useState(null);


  // The network's entry from the backend config. The reset
  // matters on a network switch: without it the previous
  // chain's balances stay on screen until the new fetches
  // land — with it the skeletons come back instantly.
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
// FadingAlert
// -----------------------------------------------------------
//
// One outcome row under the claim button: fully visible for
// 8 s, then fades out over 0.5 s. The parent drops the row
// from its list once the fade is over — the fade lives here,
// the lifetime bookkeeping lives there, each exactly once.
//
// Used by:
//   - FaucetEVM (below) — one per addAlert call
// -----------------------------------------------------------

function FadingAlert({ severity, children }) {

  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => setOpacity(0), ALERT_VISIBLE_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <MuiAlert
      severity={severity}
      sx={{ mt: 2, transition: `opacity ${ALERT_FADE_MS}ms` }}
      style={{ opacity }}
    >
      {children}
    </MuiAlert>
  );
}







// -----------------------------------------------------------
// ColorlibStepIcon
// -----------------------------------------------------------
//
// The icon inside a step bubble — install, power, hub, and an
// inline Ethereum diamond SVG for the final claim step.
//
// Used by:
//   - ProgressStepper (below)
// -----------------------------------------------------------

function ColorlibStepIcon(props) {
  const { active, completed, className } = props;

  const icons = {
    1: <InstallDesktopIcon />,
    2: <PowerSettingsNewIcon />,
    3: <HubIcon />,
    4: <svg xmlns="http://www.w3.org/2000/svg" width="2em" height="2em" viewBox="0 0 24 24"><path fill="currentColor" d="m12 1.75l-6.25 10.5L12 16l6.25-3.75zM5.75 13.5L12 22.25l6.25-8.75L12 17.25z"/></svg>,
  };

  return (
    <ColorlibStepIconRoot ownerState={{ completed, active }} className={className}>
      {icons[String(props.icon)]}
    </ColorlibStepIconRoot>
  );
}







// -----------------------------------------------------------
// ProgressStepper
// -----------------------------------------------------------
//
// The four-step Metamask flow bar: install → connect → switch
// to the network → claim. Purely presentational — activeStep
// is derived in the page.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function ProgressStepper({ activeStep, networkName }) {
  const steps = [
    'Susidiegti Metamask',
    'Prijungti Metamask',
    `Įsijungti ${networkName} Tinklą`,
    `Atsisiųsti ${networkName} ETH`,
  ];

  return (
    <Stack sx={{ width: '100%' }} spacing={4}>
      <Stepper alternativeLabel activeStep={activeStep} connector={<ColorlibConnector />}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel StepIconComponent={ColorlibStepIcon}>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
    </Stack>
  );
}







// -----------------------------------------------------------
// ClaimButton
// -----------------------------------------------------------
//
// One button, four faces — the same early returns as the
// stepper's steps: install link, connect prompt, network
// switch (adds the chain to Metamask via
// wallet_addEthereumChain when it's missing, code 4902), and
// finally the claim. Claiming signs a nonce message with the
// wallet and sends the signature to the backend, which
// verifies it before paying out. All wallet state comes from
// the parent's useWallet — this component holds only its own
// spinner.
//
// Used by:
//   - FaucetEVM (below)
// -----------------------------------------------------------

function ClaimButton({ network, networkInfo, web3, installed, account, chainId, onConnect, onSuccess, onError }) {

  const [isLoading, setIsLoading] = useState(false);


  // Ask Metamask to hop to the faucet's chain; an unknown
  // chain (error 4902) is added first from networkInfo
  const switchNetwork = async () => {
    const chainIdHex = `0x${networkInfo.chain_id.toString(16)}`;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
    } catch (err) {
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: chainIdHex,
              chainName: networkInfo.full_name,
              nativeCurrency: networkInfo.native_currency,
              rpcUrls: networkInfo.rpc_urls,
              blockExplorerUrls: networkInfo.block_explorer_urls,
            }],
          });
        } catch (addErr) {
          console.error('Failed to add network:', addErr);
          onError(`Failed to add network: ${addErr.message}`);
          return;
        }
      } else {
        console.error('Failed to switch network:', err);
        onError(`Failed to switch network: ${err.message}`);
        return;
      }
    }

    // Metamask can silently stay put — double-check it landed
    try {
      const id = await window.ethereum.request({ method: 'eth_chainId' });
      if (id !== chainIdHex) {
        onError('Failed to switch to the correct network. Please check your MetaMask settings.');
      }
    } catch (checkErr) {
      console.error('Error checking current chain:', checkErr);
    }
  };


  // Sign a fresh-nonce message and let the backend verify the
  // signature — proves the student controls the address
  // without any transaction on their side
  const claimTestnetEth = async () => {
    setIsLoading(true);
    try {
      if (!web3 || !account) {
        throw new Error('Metamask piniginė neprijungta.');
      }
      if (chainId !== networkInfo.chain_id) {
        throw new Error(`Please switch to the ${networkInfo.full_name} network before claiming.`);
      }

      const nonce = Date.now().toString();
      const message = `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;
      const signature = await web3.eth.personal.sign(message, account, '');

      const params = new URLSearchParams({ address: account, signature, nonce });
      const res = await fetch(`/api/evm/${network}/request-eth?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Nepavyko išsiųsti ${network} ETH`);

      onSuccess();
    } catch (e) {
      console.error('Error in claimTestnetEth:', e);
      onError(e.message || 'An unexpected error occurred. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };


  if (!installed) {
    return (
      <Button
        component="a"
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        variant="contained"
        fullWidth
      >
        Sudiegti MetaMask
      </Button>
    );
  }

  if (isLoading) {
    return (
      <Button variant="contained" fullWidth disabled sx={{ minHeight: 40, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={22} color="inherit" />
      </Button>
    );
  }

  if (!account) {
    return (
      <Button variant="contained" fullWidth onClick={() => onConnect().catch((e) => onError(e.message))}>
        Prijungti piniginę
      </Button>
    );
  }

  if (chainId !== networkInfo.chain_id) {
    return (
      <Button variant="contained" onClick={switchNetwork} fullWidth>
        Persijungti į {networkInfo.full_name} ETH tinklą
      </Button>
    );
  }

  return (
    <Button variant="contained" color="primary" onClick={claimTestnetEth} fullWidth>
      Gauti {networkInfo.full_name} ETH valiutos
    </Button>
  );
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
// activeStep is DERIVED from the wallet state — no effects,
// no render-time writes.
//
// Used by:
//   - main.jsx — route /faucet/evm/:network (imported as
//     FaucetEVM)
// -----------------------------------------------------------

export default function FaucetEVM() {

  const { network } = useParams();
  const navigate = useNavigate();

  const { networkInfo, faucetInfo } = useFaucetInfo(network);
  const { web3, installed, account, chainId, balance: userBalance, connect } = useWallet(networkInfo?.chain_id);

  const [alerts, setAlerts] = useState([]);


  // Add an outcome row; drop it again once its fade finished
  // (FadingAlert animates, this bookkeeping removes)
  const addAlert = (severity, message) => {
    const id = Date.now();
    setAlerts((prev) => [...prev, { id, severity, message }]);

    setTimeout(() => {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    }, ALERT_VISIBLE_MS + ALERT_FADE_MS);
  };


  if (!networkInfo || !faucetInfo) {
    return <LoadingSkeleton />;
  }


  // Where the student is in the Metamask flow — one derived
  // value drives the stepper AND the balance row wording
  const activeStep = !installed ? 0 : !account ? 1 : chainId !== networkInfo.chain_id ? 2 : 3;

  const faucetAddress = faucetInfo.address.toLowerCase();

  const formatBalance = (bal) => {
    if (bal == null) return 'Loading…';
    if (!web3) return '-';
    return `${parseFloat(web3.utils.fromWei(bal, 'ether')).toFixed(3)} ${networkInfo.short_name}`;
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

      {/* The four-step Metamask flow */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
        <ProgressStepper activeStep={activeStep} networkName={networkInfo.full_name} />
      </div>

      {/* Balances, the claim button and its outcome alerts */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">

        <div className="my-2 flex">
          <span className="flex-1">Jūsų Metamask balansas:</span>
          <span className="text-right">{activeStep === 3 ? formatBalance(userBalance) : 'Piniginė neprijungta'}</span>
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
          <ClaimButton
            network={network}
            networkInfo={networkInfo}
            web3={web3}
            installed={installed}
            account={account}
            chainId={chainId}
            onConnect={connect}
            onSuccess={() => addAlert('success', `${networkInfo.full_name} išsiųstas į jūsų piniginę.`)}
            onError={(e) => addAlert('error', e)}
          />
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
