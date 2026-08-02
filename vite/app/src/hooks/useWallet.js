// -----------------------------------------------------------
//  [*] useWallet — the app's MetaMask hook
//
//  Everything the EVM-family faucet pages need from the
//  browser wallet: one Web3 instance, the active account and
//  chain (kept fresh through MetaMask's own events), the
//  user's balance, and the three actions — connect, switch to
//  the faucet's chain, and sign the ownership message.
//
//  The returned `step` is the single source of truth for how
//  far the student has got: 0 install → 1 connect → 2 switch
//  network → 3 ready. Both faucet pages drive their stepper,
//  their gate button and their claim buttons from it.
//
//  signMessage() owns the exact wording of the message the
//  backend verifies — it lives here so the EVM and ERC-20
//  pages can never drift apart from each other or from the
//  Python side.
//
//  Used by:
//    - pages/Faucet_EVM/Page.jsx
//    - pages/Faucet_ERC20/Page.jsx
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import Web3 from 'web3';


// How often the user's balance repolls — fast, so students
// see it tick up right after a claim
const WALLET_REFRESH_MS = 1000;







// -----------------------------------------------------------
// useWallet (default export)
// -----------------------------------------------------------
//
//   const { web3, installed, account, chainId, balance, step,
//           connect, switchNetwork, signMessage } =
//     useWallet(expectedChainId)
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

export default function useWallet(expectedChainId) {

  const [web3, setWeb3] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [balance, setBalance] = useState(null);


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


  // Balance repoll — re-checks the chain on every tick because
  // the student can switch networks in MetaMask at any moment
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


  // Hop to the faucet's chain; a chain MetaMask doesn't know
  // (error 4902) is added first from the network config, and
  // the result is verified because MetaMask can silently stay
  // put
  const switchNetwork = async (networkInfo) => {
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
          chainName: networkInfo.full_name,
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
  };


  // The proof of wallet ownership every payout needs: a fresh
  // nonce inside a fixed message, signed in MetaMask. The
  // wording must match the backend's verification byte for
  // byte — this is the only place it is written.
  const signMessage = async () => {
    if (!web3 || !account) {
      throw new Error('Metamask piniginė neprijungta.');
    }

    const nonce = Date.now().toString();
    const message = `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;
    const signature = await web3.eth.personal.sign(message, account, '');

    return { nonce, signature };
  };


  // 0 install → 1 connect → 2 switch network → 3 ready. With
  // no expectedChainId there is no chain to be wrong about, so
  // a connected wallet goes straight to ready.
  const step = !installed ? 0
    : !account ? 1
    : (expectedChainId && chainId !== expectedChainId) ? 2
    : 3;


  return { web3, installed, account, chainId, balance, step, connect, switchNetwork, signMessage };
}
