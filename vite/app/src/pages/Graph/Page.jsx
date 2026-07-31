// -----------------------------------------------------------
//  [*] Pages — Transaction Graph (route /graph/:network)
//
//  Entry point of the transaction-flow visualization: resolves
//  the network's faucet address (the graph's root node) via
//  GET /api/evm/<network>/faucet-balance, then mounts
//  CryptoFlowGraph. Until then: Lithuanian loading / error /
//  empty states.
//
//  Used by:
//    - main.jsx — route /graph/:network (imported as GraphPage)
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';

import CryptoFlowGraph from './CryptoFlowGraph';


export default function GraphPage() {

  const { network } = useParams();

  const [address, setAddress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);


  // Resolve the faucet address whenever the network changes;
  // the ignore flag drops late responses after an unmount or
  // a mid-flight network switch. The error is cleared on every
  // attempt so one failed network doesn't stick to the next.
  useEffect(() => {
    if (!network) return;

    let ignore = false;

    const loadFaucetAddress = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data } = await axios.get(`/api/evm/${network}/faucet-balance`);
        if (!ignore) setAddress(data.address);
      } catch (error) {
        console.error('Failed to fetch faucet address:', error);
        if (!ignore) setError('Nepavyko gauti čiaupo adreso');
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    loadFaucetAddress();
    return () => { ignore = true; };
  }, [network]);


  if (loading) {
    return <div className="p-4 text-center">Kraunama…</div>;
  }

  if (error) {
    return <div className="p-4 text-center text-red-600">{error}</div>;
  }

  if (!address) {
    return <div className="p-4 text-center">Adresas nerastas</div>;
  }

  return (
    <div className="p-4">
      <CryptoFlowGraph faucetAddress={address} network={network} />
    </div>
  );
}
