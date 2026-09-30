// -----------------------------------------------------------
//  [*] Test support — the EVM graph's backend, as a small model
//
//  The graph asks one endpoint over and over — GET
//  /api/evm/<network>/get-stored-transactions?address=&from=&to=
//  — once per known address per sweep, plus the rename
//  endpoint. A fixed body cannot show what the graph is about
//  (a transfer appearing live, a name that survives the next
//  sweep, a hop discovered from the one before), so the graph
//  tests run against a model of the backend's two tables:
//
//    transfers — { from, to, value, at } (at: unix seconds)
//    addresses — address → { name, contract, hub }
//
//  answered the way backend/app/evm_faucet/explorer.py's
//  get_stored_transactions answers: the transfers inside
//  [from, to) that touch the asked address, ONE flow per
//  (from, to) pair with the summed value and the count, both
//  sides' names and contract / hub flags (null for an address
//  the backend never classified — its LEFT JOIN) and each
//  side's last-seen time inside the window. set-address-name
//  upserts the name like set_address_name does (trimmed, cut
//  at 64).
//
//  installGraphBackend({ transfers, addresses }) → the model:
//
//    .transfers / .addresses — mutable: a test adds a transfer
//                              or a name, the next request
//                              answers from it
//    .requests               — every stored-transactions
//                              request: { network, address,
//                              from, to, at } (at: Date.now()
//                              on the test's clock)
//    .renames                — every rename: { address, name }
//    .outage                 — true: every stored-transactions
//                              request answers 500 { error };
//                              'html': the proxy's 502 page;
//                              'drop': the connection drops
//    .renameOutage           — the same for set-address-name
//    .hold() → release()     — requests wait until release();
//                              .inFlight / .maxInFlight count
//                              the ones waiting
//    .asked(address)         — the requests for one address
//    .answerOnce(address, body)
//                            — the next request about that
//                              address gets `body` (any JSON,
//                              a malformed one included)
//                              instead of the model's answer
//
//  Used by:
//    - tests/pages/graph-evm/*.test.jsx
// -----------------------------------------------------------

import { http, HttpResponse } from 'msw';
import { server, url, apiError } from '../backend/server';


const NAME_MAX_LENGTH = 64;

// How an outage answers: the backend's 500, the proxy's HTML
// 502 page, or a dropped connection
const failure = (kind) => {
  if (kind === 'drop') return HttpResponse.error();
  if (kind === 'html') return new HttpResponse('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
  return HttpResponse.json(apiError('Vidinė serverio klaida'), { status: 500 });
};







// -----------------------------------------------------------
// flowsOf
// -----------------------------------------------------------
//
// The stored-transactions answer for one address and window —
// get_stored_transactions' SQL (GetLatestUpdate + GetFlows)
// over the model.
//
// Used by:
//   - installGraphBackend (below)
// -----------------------------------------------------------

function flowsOf(model, address, from, to) {
  const inWindow = model.transfers.filter((t) => t.at >= from && t.at < to);

  // Each address's last appearance inside the window, on
  // either side of a transfer
  const latest = new Map();
  for (const t of inWindow) {
    for (const side of [t.from, t.to]) latest.set(side, Math.max(latest.get(side) ?? 0, t.at));
  }

  const flows = new Map();
  for (const t of inWindow.filter((candidate) => candidate.from === address || candidate.to === address)) {
    const key = `${t.from}-${t.to}`;
    const flow = flows.get(key) ?? { from: t.from, to: t.to, value: 0, count: 0 };
    flow.value += t.value;
    flow.count += 1;
    flows.set(key, flow);
  }

  const row = (side) => model.addresses[side];
  const flag = (side, key) => (row(side) ? (row(side)[key] ? 1 : 0) : null);

  return [...flows.values()].map((flow) => ({
    from_address: flow.from,
    from_name: row(flow.from)?.name ?? null,
    from_timestamp: latest.get(flow.from),
    to_address: flow.to,
    to_name: row(flow.to)?.name ?? null,
    to_timestamp: latest.get(flow.to),
    from_addr_contract: flag(flow.from, 'contract'),
    to_addr_contract: flag(flow.to, 'contract'),
    from_addr_hub: flag(flow.from, 'hub'),
    to_addr_hub: flag(flow.to, 'hub'),
    value: flow.value,
    count: flow.count,
  }));
}







// -----------------------------------------------------------
// installGraphBackend
// -----------------------------------------------------------
//
// Installs the two handlers (server.use — dropped by the
// handler reset after the test) and returns the model; see
// the header for its fields.
//
// Used by:
//   - tests/pages/graph-evm/*.test.jsx
// -----------------------------------------------------------

export function installGraphBackend({ transfers = [], addresses = {} } = {}) {

  let gate = null;
  const onceBodies = new Map();

  const model = {
    transfers: transfers.map((t) => ({ ...t })),
    addresses: structuredClone(addresses),
    requests: [],
    renames: [],
    outage: false,
    renameOutage: false,
    inFlight: 0,
    maxInFlight: 0,

    hold() {
      let open;
      const closed = new Promise((resolve) => { open = resolve; });
      gate = closed;
      return () => {
        if (gate === closed) gate = null;
        open();
      };
    },

    asked(address) {
      return model.requests.filter((request) => request.address === address);
    },

    answerOnce(address, body) {
      onceBodies.set(address, body);
    },
  };

  server.use(
    http.get(url('/api/evm/:network/get-stored-transactions'), async ({ request, params }) => {
      const query = new URL(request.url).searchParams;
      const asked = {
        network: params.network,
        address: query.get('address'),
        from: Number(query.get('from')),
        to: Number(query.get('to')),
        at: Date.now(),
      };
      model.requests.push(asked);

      model.inFlight += 1;
      model.maxInFlight = Math.max(model.maxInFlight, model.inFlight);
      try {
        if (gate) await gate;
      } finally {
        model.inFlight -= 1;
      }

      if (model.outage) return failure(model.outage);
      if (onceBodies.has(asked.address)) {
        const body = onceBodies.get(asked.address);
        onceBodies.delete(asked.address);
        return HttpResponse.json(body);
      }
      return HttpResponse.json({ transactions: flowsOf(model, asked.address?.toLowerCase(), asked.from, asked.to) });
    }),

    http.get(url('/api/evm/set-address-name'), ({ request }) => {
      const query = new URL(request.url).searchParams;
      const address = query.get('address');
      const name = query.get('name');
      model.renames.push({ address, name });
      if (model.renameOutage) return failure(model.renameOutage);
      if (!address) return HttpResponse.json(apiError('Trūksta adreso'), { status: 400 });

      const key = address.toLowerCase();
      model.addresses[key] = { contract: false, hub: false, ...model.addresses[key], name: (name ?? '').trim().slice(0, NAME_MAX_LENGTH) };
      return HttpResponse.json({ status: 'OK' });
    }),
  );

  return model;
}
