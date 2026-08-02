// -----------------------------------------------------------
//  [*] ReorgAttack — useReorgAttack
//
//  The whole backend side of the 51% attack tool: two polling
//  queries (the chain itself and the node status) plus the
//  four actions the control panel triggers.
//
//  Every action is a mutation that INVALIDATES the queries on
//  success instead of guessing a refresh delay — the previous
//  implementation re-fetched via setTimeout(…, 1000/2000) and
//  optimistically flipped the connection switch by hand, which
//  drifted from the backend whenever a call was slow or
//  failed. Here the switch is derived from the status query,
//  so it can only ever show what the backend reported.
//
//  The backend answers { success, message, ... }: a false
//  success is turned into a thrown Error, so failures land in
//  the mutations' onError and reach the student as a toast.
//
//  Split into (root export last):
//
//    API_BASE          — the blueprint's URL prefix
//    REFRESH_MS        — how often both queries repoll
//    TOAST_SUCCESS_MS / TOAST_ERROR_MS — toast lifetimes
//    unwrap            — { success, … } → payload or throw
//    useReorgAttack    — queries + mutations (default export)
// -----------------------------------------------------------

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import axios from 'axios';


// The reorg-attack blueprint's URL prefix
const API_BASE = '/api/reorgattack';


// Both queries repoll at this cadence — the nodes mine in the
// background, so the view would otherwise go stale
const REFRESH_MS = 10000;


// A confirmation can flash by; a failure carries the reason
// the student needs to read, so it stays up much longer
const TOAST_SUCCESS_MS = 3000;
const TOAST_ERROR_MS = 8000;


// The backend's envelope: { success, message, ...payload }.
// A false success carries the reason in message — raise it so
// TanStack routes it to onError / isError like any failure.
const unwrap = (payload) => {
  if (!payload?.success) {
    throw new Error(payload?.message || 'Operacija nepavyko');
  }
  return payload;
};







// -----------------------------------------------------------
// useReorgAttack (default export)
// -----------------------------------------------------------
//
//   const {
//     chainBlocks, chainTips, transactions,  — the chain
//     networkStatus, isConnectedToPublic,    — node status
//     isPending, isError,                    — first load
//     toggleConnection,                      — (connected)
//     sendRawTransaction,                    — ({raw, color})
//     addTransaction,                        — ({txid, color})
//     removeTransaction,                     — (txid)
//     isMutating,                            — any action busy
//   } = useReorgAttack()
//
// Every action reports its outcome as a react-hot-toast
// bubble; the page mounts the <Toaster> they land in.
//
// Used by:
//   - Page.jsx — the single instance behind the whole page
// -----------------------------------------------------------

export default function useReorgAttack() {

  const queryClient = useQueryClient();


  // The chain: blocks, the two tips and the tracked
  // transactions — one payload, one poll
  const blockchain = useQuery({
    queryKey: ['reorg-blockchain'],
    queryFn: async () => unwrap((await axios.get(`${API_BASE}/blockchain/data`)).data).data,
    refetchInterval: REFRESH_MS,
  });


  // Node status: peer count, both tips, and whether the
  // private node is currently attached to the public network
  const status = useQuery({
    queryKey: ['reorg-status'],
    queryFn: async () => unwrap((await axios.get(`${API_BASE}/status`)).data).status ?? {},
    refetchInterval: REFRESH_MS,
  });


  // Every action refreshes both queries on success — the
  // backend is the only source of truth for what actually
  // happened, so nothing is updated optimistically
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['reorg-blockchain'] });
    queryClient.invalidateQueries({ queryKey: ['reorg-status'] });
  };

  // The failure line, then the backend's reason underneath it
  const reportFailure = (headline) => (error) => {
    toast.error(<b>{headline}<br />{error.message}</b>, { duration: TOAST_ERROR_MS });
  };


  // Attach/detach the private node from the public network —
  // the actual 51% attack switch
  const connection = useMutation({
    mutationFn: async (connected) =>
      unwrap((await axios.get(`${API_BASE}/${connected ? 'connect' : 'disconnect'}`)).data),
    onSuccess: (_data, connected) => {
      toast.success(
        <b>{connected ? 'Prisijungta prie viešo tinklo' : 'Atjungta nuo viešo tinklo'}</b>,
        { duration: TOAST_SUCCESS_MS }
      );
      invalidate();
    },
    onError: reportFailure('Prisijungimo operacija nepavyko'),
  });


  // Broadcast a raw HEX transaction into the private node
  const rawTransaction = useMutation({
    mutationFn: async ({ raw, color }) =>
      unwrap((await axios.post(`${API_BASE}/transactions/send`, {
        raw_transaction: raw,
        color,
      })).data),
    onSuccess: (data) => {
      toast.success(
        <b>Transakcija sėkmingai išsiųsta!<br />TXID: {data.txid}</b>,
        { duration: TOAST_SUCCESS_MS }
      );
      invalidate();
    },
    onError: reportFailure('Nepavyko išsiųsti transakcijos'),
  });


  // Start colour-tracking a txid across both chains
  const trackTransaction = useMutation({
    mutationFn: async ({ txid, color }) =>
      unwrap((await axios.post(`${API_BASE}/transactions`, { txid, color })).data),
    onSuccess: () => {
      toast.success(<b>Transakcija pridėta į sekamų sąrašą</b>, { duration: TOAST_SUCCESS_MS });
      invalidate();
    },
    onError: reportFailure('Nepavyko pridėti transakcijos'),
  });


  const untrackTransaction = useMutation({
    mutationFn: async (txid) =>
      unwrap((await axios.delete(`${API_BASE}/transactions/${txid}`)).data),
    onSuccess: () => {
      toast.success(<b>Transakcija pašalinta iš sekamų sąrašo</b>, { duration: TOAST_SUCCESS_MS });
      invalidate();
    },
    onError: reportFailure('Nepavyko pašalinti transakcijos'),
  });


  return {
    chainBlocks: blockchain.data?.chainBlocks ?? [],
    chainTips: blockchain.data?.chainTips ?? { public: null, private: null },
    transactions: blockchain.data?.transactions ?? [],

    networkStatus: status.data ?? {},
    // Derived, never stored: the switch shows the backend's
    // reality, so a failed toggle needs no manual revert
    isConnectedToPublic: Boolean(status.data?.isConnectedToPublic),

    isPending: blockchain.isPending,
    isError: blockchain.isError,
    error: blockchain.error,

    toggleConnection: connection.mutate,
    sendRawTransaction: rawTransaction.mutate,
    addTransaction: trackTransaction.mutate,
    removeTransaction: untrackTransaction.mutate,
    isMutating: connection.isPending || rawTransaction.isPending
      || trackTransaction.isPending || untrackTransaction.isPending,
  };
}
