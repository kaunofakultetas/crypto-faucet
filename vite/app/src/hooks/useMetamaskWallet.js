// -----------------------------------------------------------
//  [*] useMetamaskWallet — MetaMask on EVM chains
//
//  The EVM-family pages' wallet hook — window.ethereum plus
//  one Web3 instance, with account and chain kept fresh
//  through MetaMask's own events. The returned `step` is the
//  single source of truth:
//  0 install → 1 connect → 2 switch network → 3 ready.
//
//  Split into (root last) — the MetaMask conversations are
//  plain functions, the hook wires their results into state:
//
//    WALLET_REFRESH_MS — balance repoll cadence
//    connectMetamask   — the connect conversation
//    requestChainHop   — the switch/add-chain conversation
//    signClaimMessage  — the ownership-proof conversation
//    useMetamaskWallet — state wiring + balance + step
//                        (default export)
//
//  Used by:
//    - pages/Faucet_EVM/Page.jsx
//    - pages/Faucet_ERC20/Page.jsx
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Web3 from 'web3';


// How often the user's balance repolls — fast, so students
// see it tick up right after a claim
const WALLET_REFRESH_MS = 1000;







// -----------------------------------------------------------
// connectMetamask
// -----------------------------------------------------------
//
// The connect conversation: ask MetaMask for the accounts
// and hand back the first, or null when none arrive.
// MetaMask's own rejection error is passed through — the
// pages display e.message.
//
// Used by:
//   - useMetamaskWallet (below) — connect()
// -----------------------------------------------------------

async function connectMetamask() {
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  return accounts[0] ?? null;
}







// -----------------------------------------------------------
// requestChainHop
// -----------------------------------------------------------
//
// The chain-hop conversation: switch MetaMask to the
// faucet's chain. A chain it doesn't know (error 4902) is
// added first from the network config, and the landing is
// verified afterwards, because MetaMask can silently stay
// put. Throws a ready-to-display Lithuanian message. Touches
// no state — the chainChanged event reports the outcome.
//
// Used by:
//   - useMetamaskWallet (below) — switchNetwork()
// -----------------------------------------------------------

async function requestChainHop(networkInfo) {
  const chainIdHex = `0x${networkInfo.chain_id.toString(16)}`;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    if (err.code !== 4902) {
      throw new Error(`Nepavyko persijungti į tinklą: ${err.message}`);
    }

    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainIdHex,
        // chain_name is the config's metamask-section name —
        // the one the wallet STORES; full_name is only the
        // faucet UI's display name
        chainName: networkInfo.chain_name || networkInfo.full_name,
        nativeCurrency: networkInfo.native_currency,
        rpcUrls: networkInfo.rpc_urls,
        blockExplorerUrls: networkInfo.block_explorer_urls,
      }],
    }).catch((addErr) => {
      throw new Error(`Nepavyko pridėti tinklo: ${addErr.message}`);
    });
  }

  const landedOn = await window.ethereum.request({ method: 'eth_chainId' });
  if (landedOn !== chainIdHex) {
    throw new Error('Nepavyko persijungti į reikiamą tinklą. Patikrinkite MetaMask nustatymus.');
  }
}







// -----------------------------------------------------------
// signClaimMessage
// -----------------------------------------------------------
//
// The ownership-proof conversation: a fresh nonce inside the
// fixed message, signed in MetaMask via personal_sign. The
// wording must match the EVM backend's verification byte for
// byte — this is the only place it is written, so the EVM
// and ERC-20 pages can never drift apart.
//
// Used by:
//   - useMetamaskWallet (below) — signMessage()
// -----------------------------------------------------------

async function signClaimMessage(web3, account) {
  if (!web3 || !account) {
    throw new Error('Metamask piniginė neprijungta.');
  }

  const nonce = Date.now().toString();
  const message = `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;
  const signature = await web3.eth.personal.sign(message, account, '');

  return { nonce, signature };
}







// -----------------------------------------------------------
// useMetamaskWallet (default export)
// -----------------------------------------------------------
//
//   const { web3, installed, account, chainId, balance, step,
//           connect, switchNetwork, signMessage } =
//     useMetamaskWallet(expectedChainId)
//
// expectedChainId is the faucet network's chain id; the
// balance is only fetched while the wallet is actually on it,
// so a wrong-chain wallet shows "not connected" instead of a
// number from somewhere else. Pass nothing on pages that are
// chain-agnostic (the ERC-20 faucet spans many chains at
// once) — then a connected wallet is already step 3 and no
// balance is polled. connect/switchNetwork/signMessage all
// reject with a ready-to-display message.
//
// Used by:
//   - both faucet pages (see the file header)
// -----------------------------------------------------------

export default function useMetamaskWallet(expectedChainId) {

  const [web3, setWeb3] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);


  // Detect MetaMask once; the listeners keep account/chain in
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


  // Balance repoll — TanStack Query owns the timer and the
  // stale-response handling. The chain is re-checked on every
  // tick because the student can switch networks in MetaMask
  // at any moment; a wrong-chain wallet reports null so pages
  // never show a number from somewhere else.
  const { data: balance = null } = useQuery({
    queryKey: ['wallet-balance', account, expectedChainId],
    enabled: Boolean(web3 && account && expectedChainId),
    refetchInterval: WALLET_REFRESH_MS,
    retry: false,
    queryFn: async () => {
      const currentId = await web3.eth.getChainId();
      if (Number(currentId) !== Number(expectedChainId)) return null;
      return await web3.eth.getBalance(account);
    },
  });


  // The actions are the MetaMask conversations at the top of
  // the file — connect is the only one whose result becomes
  // state; the chain hop's outcome arrives via chainChanged
  const connect = () => connectMetamask().then((acc) => {
    if (acc) setAccount(acc);
  });

  const switchNetwork = requestChainHop;

  const signMessage = () => signClaimMessage(web3, account);


  // 0 install → 1 connect → 2 switch network → 3 ready. With
  // no expectedChainId there is no chain to be wrong about, so
  // a connected wallet goes straight to ready.
  const step = !installed ? 0
    : !account ? 1
    : (expectedChainId && chainId !== expectedChainId) ? 2
    : 3;


  return { web3, installed, account, chainId, balance, step, connect, switchNetwork, signMessage };
}
