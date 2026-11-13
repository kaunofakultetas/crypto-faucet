// -----------------------------------------------------------
//  [*] MetaMask tests — the faucet without its backend
//
//  Serves the built faucet site to the test browser, with a
//  double in the backend's place: the public answers the
//  pages read on load are the ones kept in ../backend (taken
//  once from the real backend — the network list and the
//  token contracts a student's wallet is handed are the real
//  ones), and a claim, of coins or of tokens, is only
//  WRITTEN DOWN. Nothing is ever signed or paid: no faucet
//  key exists here, and the test container could not reach a
//  chain's node with one anyway.
//
//  One thing the double does exactly as the backend: it reads
//  a claim's signature. The signer of the fixed sentence with
//  the claim's nonce must be the address the claim names, or
//  the claim is refused in the backend's own words and not
//  written down — "the claim reached the backend" then means
//  one the real backend would have paid, not merely a request
//  of the right shape.
//
//  Every test gets a faucet of its own on a free port, so the
//  claims one test sees are its own.
// -----------------------------------------------------------

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMessage } from 'ethers';


// The built site, copied into the image from the production
// build (Dockerfile.metamask)
const SITE = process.env.FAUCET_SITE ?? '/work/site';

// The backend's kept answers
const ANSWERS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');

// The content type of each kind of file the site consists of
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// The transaction a recorded claim is answered with — a hash
// of the right shape that names no transaction anywhere
const PAID_NOTHING = `0x${'ab'.repeat(32)}`;

// The picture every network and token icon is answered with:
// an empty drawing, so the pages log no missing file
const BLANK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';

// What a token's symbol may consist of — it becomes part of
// the name of the kept answer that is read
const SYMBOL = /^[A-Za-z0-9]+$/;

// The sentence a claim's signature is made over, the nonce
// right after it — the backend's own words, and the page's
const CLAIM_MESSAGE = 'Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ';

// What the backend answers a claim whose signature was not
// made by the address it names
const NOT_SIGNED_BY_IT = 'Parašas neatitinka nurodyto adreso. Prijunkite tą pačią piniginę ir bandykite dar kartą.';







// -----------------------------------------------------------
// signedByItsAddress
// -----------------------------------------------------------
//
// The backend's signature check: a wallet's signature of a
// text names its signer, and the signer of the claim sentence
// with this nonce must be the claim's address. A signature
// that cannot be read at all names nobody.
//
// Used by:
//   - answer (below)
// -----------------------------------------------------------

function signedByItsAddress({ address, nonce, signature }) {
  try {
    return verifyMessage(`${CLAIM_MESSAGE}${nonce}`, signature).toLowerCase() === (address ?? '').toLowerCase();
  } catch {
    return false;
  }
}







// -----------------------------------------------------------
// tokenAnswer
// -----------------------------------------------------------
//
// The kept answer about one token: the chains it lives on,
// with the contract's address on each. Asked with a wallet's
// address the real backend adds how much native coin that
// wallet holds on each chain, and the page lets a student
// claim only above the chain's minimum — the double says
// twice the minimum, so the test wallet, which holds nothing
// anywhere, is past the gas step the way a student is who
// took coins first. A token there is no kept answer for is
// the backend's 404.
//
// Used by:
//   - answer (below)
// -----------------------------------------------------------

function tokenAnswer(symbol, address) {
  const kept = path.join(ANSWERS, `erc20-token-${symbol}.json`);
  if (!SYMBOL.test(symbol) || !fs.existsSync(kept)) return { status: 404, body: JSON.stringify({ error: 'Nerasta' }) };

  const token = JSON.parse(fs.readFileSync(kept, 'utf8'));
  if (address) {
    for (const deployment of token.deployments) {
      deployment.wallet_native_wei = String(2n * BigInt(deployment.min_native_wei ?? '0'));
    }
  }
  return { status: 200, body: JSON.stringify(token) };
}







// -----------------------------------------------------------
// answer
// -----------------------------------------------------------
//
// The double's answer to one /api request: the kept answer of
// the reads the EVM and the token pages make — every network
// shares one faucet balance — an empty picture for an icon, a
// claim written into `claims` and answered like a payout (a
// token claim carries the token's symbol besides) or refused
// like a claim nobody signed, and a plain 404 for anything
// else, the way the real backend answers a route it does not
// have.
//
// Used by:
//   - startFaucet (below)
// -----------------------------------------------------------

function answer(url, claims) {
  const kept = (name) => ({ status: 200, body: fs.readFileSync(path.join(ANSWERS, name), 'utf8') });
  const paid = { status: 200, body: JSON.stringify({ message: 'recorded by the test double — nothing was paid', transaction_hash: PAID_NOTHING }) };
  const refused = { status: 403, body: JSON.stringify({ error: NOT_SIGNED_BY_IT }) };
  const signed = { address: url.searchParams.get('address'), nonce: url.searchParams.get('nonce'), signature: url.searchParams.get('signature') };

  if (url.pathname === '/api/faucet/catalog') return kept('faucet-catalog.json');
  if (url.pathname === '/api/evm/networks') return kept('evm-networks.json');
  if (/^\/api\/evm\/[^/]+\/faucet-balance$/.test(url.pathname)) return kept('evm-faucet-balance.json');
  if (url.pathname.startsWith('/api/icons/')) return { status: 200, type: 'image/svg+xml', body: BLANK_ICON };

  const token = url.pathname.match(/^\/api\/erc20\/token\/([^/]+)$/);
  if (token) return tokenAnswer(token[1], url.searchParams.get('address'));

  const coins = url.pathname.match(/^\/api\/evm\/([^/]+)\/request$/);
  if (coins) {
    if (!signedByItsAddress(signed)) return refused;
    claims.push({ network: coins[1], ...signed });
    return paid;
  }

  const tokens = url.pathname.match(/^\/api\/erc20\/([^/]+)\/([^/]+)\/request$/);
  if (tokens) {
    if (!signedByItsAddress(signed)) return refused;
    claims.push({ network: tokens[1], token: tokens[2], ...signed });
    return paid;
  }

  return { status: 404, body: JSON.stringify({ error: 'Nerasta' }) };
}







// -----------------------------------------------------------
// startFaucet
// -----------------------------------------------------------
//
// Starts one faucet on a free local port: the site's files,
// the single-page app's index for every route that is no
// file, and the double behind /api. Hands back its address,
// the claims that reached it so far and the way to stop it.
//
// Used by:
//   - support/test.mjs — the `faucet` fixture
// -----------------------------------------------------------

export async function startFaucet() {
  const claims = [];

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      const { status, body, type = 'application/json' } = answer(url, claims);
      response.writeHead(status, { 'content-type': type });
      response.end(body);
      return;
    }

    let file = path.join(SITE, path.normalize(url.pathname));
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(SITE, 'index.html');
    response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://localhost:${server.address().port}`,
    claims: () => [...claims],
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
