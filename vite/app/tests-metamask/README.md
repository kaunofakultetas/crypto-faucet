# MetaMask tests

The faucet's wallet pages in a real Chromium with the real MetaMask
extension, played the way the lectures go: a brand-new wallet connects,
has a network added and claims; the same wallet comes back at a later
lecture, locked, and claims on other networks; tokens are claimed and
shown in MetaMask; MetaMask is installed next to an open page.

The vitest suite next door (`../tests`) cannot do this. It runs against
a stand-in wallet that behaves the way MetaMask is supposed to, and the
wallet students install is a new build almost every week. On
12 November 2026 a laboratory failed because MetaMask 13.55 had started
to refuse signatures on every network a page adds to it
([MetaMask issue 47773](https://github.com/MetaMask/metamask-extension/issues/47773))
while every faucet test stayed green.

Run it before a laboratory, not on every change: the eleven tests take
some seven minutes, after the images are built. It is no part of the
vitest suite and `runTests.sh` never runs it — vitest collects
`tests/**/*.test.*` only, and these tests need an image with a browser.

**A green run is not a promise.** It says that the lecture flows below
work with the MetaMask build named in the run's first line. What it
cannot see is listed under "What is not tested".

## Running

```sh
../../runMetamaskTests.sh                            # everything, no internet in the container
ONLINE=1 ../../runMetamaskTests.sh                   # the same, MetaMask allowed to reach the internet
../../runMetamaskTests.sh tests/claim.spec.mjs       # one file
../../runMetamaskTests.sh -g "Sepolia"               # the tests whose name contains this
METAMASK_VERSION=13.54.0 ../../runMetamaskTests.sh   # a release from GitHub instead of the store's build
METAMASK_PREVIOUS=13.52.0 ../../runMetamaskTests.sh  # another build for the returning student's wallet
```

The script builds the site with the production Dockerfile's builder
stage, builds the test image on top of it (`../../Dockerfile.metamask`:
Chromium, two MetaMask builds, the site) and runs the tests in a
throwaway container. Nothing can be paid out either way — the backend
is a double — and the host needs no node and no browser.

By default the container has **no network**: the run is the same every
time and depends on nobody's servers. `ONLINE=1` lets MetaMask reach the
internet, as it does in the lecture room: it then fetches its settings
and runs its safety checks. Use it as a second look before an important
laboratory; it is slower and can fail for reasons outside the faucet.

The store's MetaMask is downloaded once a day: the first run of a day
fetches it, later runs that day reuse it. The run names what it tests
in its first lines:

```
MetaMask 13.56.0.0 in Chromium 141.0.7390.37 — no internet, nothing is paid out
Wallets from an earlier lecture: made under MetaMask 13.54.0.0
```

## What is tested

| File | Test | It fails when |
|---|---|---|
| `tests/claim.spec.mjs` | A brand-new wallet claims on zkSync Sepolia, a network the page has MetaMask add | the claim does not reach the backend for the account that signed — the laboratory of 12 November |
| | The same on Sepolia, a network MetaMask ships | the plain road is broken: connect, permit the network, sign |
| | The student declines the connect window the repair brings up | the page does not say what to do, or the next try does not go through |
| `tests/later-lecture.spec.mjs` | A wallet made under today's MetaMask comes back after the browser was closed: locked, connected from last time. It claims on the network of the first lecture, on a network new to it, on one MetaMask ships, and on the first again | any of those claims does not reach the backend, or the page is given another account |
| | The same with a wallet made under an **older** MetaMask, today's put over it before the second lecture | the same — this is the wallet most students hold after the first lecture |
| `tests/tokens.spec.mjs` | A brand-new wallet takes Sepolia coins for gas, claims LINK and presses "Rodyti MetaMask" | the token claim does not reach the backend, or the token is not in MetaMask's list afterwards |
| | A wallet sitting on another chain opens a token's page | the page does not take it to the token's chain, or the claim fails there |
| `tests/install.spec.mjs` | MetaMask is installed while the page is open | the page stays on "Susidiegti MetaMask", or reloads more than once |
| | The same under an extension id the page does not know | the page does not reload when the student comes back to the tab |
| | A page that came up with MetaMask | the page reloads by itself |
| `tests/networks.spec.mjs` | One wallet claims on every EVM network of the faucet, one after the other | MetaMask neither knows a network nor accepts it from the page, or a claim on any of them does not reach the backend |

"Reaches the backend" means more than a request of the right shape: the
double checks the signature the way the real backend does, and refuses
a claim that was not signed by the address it names.

## Reading a run

**The networks table.** Printed with every run: which networks a
brand-new MetaMask knows and which the page has to add, each with what
MetaMask asked on the way to the claim. The added ones are where the
13.55 defect bites and the page's repair is needed.

```
Networks, as a brand-new MetaMask sees them, and what it asked on the way to the claim:
  Arbitrum Sepolia     has to be ADDED by the page  connect → add-network → connect → signature
  Ethereum Sepolia     known to MetaMask            permissions → signature
```

**What MetaMask asked.** The later-lecture tests print the windows
MetaMask put in front of each claim. This is what students will see
that day, so it is worth a glance before the lecture:

```
A wallet made under an older MetaMask and updated since — what MetaMask asked:
  first lecture, zkSync Sepolia: connect → add-network → signature
  later lecture, the network of the first lecture (zkSync Sepolia): unlock → connect → signature
  later lecture, a network new to the wallet, added by the page (Ethereum Hoodi): add-network → connect → signature
  later lecture, a network MetaMask ships (Ethereum Sepolia): permissions → signature
  later lecture, the first network again (zkSync Sepolia): signature
```

A `connect` right before a `signature` is the page's repair at work:
MetaMask refused to sign and the page asked for the account again. The
roads are printed, not pinned: a MetaMask that asks for less still
passes, and the printout shows that it does.

**The zkSync line.** The first claim test says which road it met.
"MetaMask refused the first signature on the added network — the page
asked for the account again and the claim went through" means the
defect is still in that build and the repair works. "MetaMask signed at
once" means MetaMask has mended it; the third claim test is then
skipped, because there is no window left to decline.

**flaky.** A failed test is run once more before it counts. One that
passes at the second try is listed as flaky: a MetaMask window came up
late. The same test flaky run after run is worth a look.

**A failed test** prints every MetaMask window it saw, in order, with
MetaMask's own name for the request, the answer the test gave and the
window's text; a restart of the browser is noted where it happened.
Then come the faucet pages' lines, tab by tab: what the page told the
student in its alerts ("shown to the student") and the warnings and
errors it logged. Among those, "Failed to fetch" and "RPC endpoint
returned too many errors" are MetaMask without internet and mean
nothing; a line like "The requested account and/or method has not been
authorized by the user" is the wallet refusing the page. The usual
causes, most likely first:

1. *MetaMask changed its screens.* The error names a window "this suite
   cannot name", says MetaMask holds a question "but its window never
   came to read" its sentence, or says the first-run pages "did not end
   in a wallet" and lists the test ids on screen. The wallet works, the
   test no longer knows its way around it: update `WINDOWS`,
   `YES_BUTTONS`, `LOCK` or `SETUP_STEPS` at the top of
   `support/metamask.mjs`.
2. *MetaMask changed its behaviour.* The windows are recognised but
   the page shows an error where the claim should be, or MetaMask "asks
   nothing" where a window was expected. This is the case the suite
   exists for. Run `METAMASK_VERSION=<the last good release>` to confirm
   the older build still passes, then fix the page.
3. *The faucet page changed.* A button was renamed or a text reworded;
   the tests look for the Lithuanian labels a student sees.

## What is real and what is not

Real: Chromium (the image's 141, older than the Chrome students run),
the MetaMask build from the store under the store's extension id, the
site exactly as the production build makes it, the wallet's own
first-run pages and lock screen, the browser closed and started again
on the same profile, and every answer given in MetaMask's own window.

Stood in:

- **The backend.** `support/faucet-double.mjs` answers the pages' reads
  with the answers kept in `backend/`, checks a claim's signature like
  the real backend and writes the claim down instead of paying it. No
  faucet key exists in the container. For the token page it says the
  wallet holds enough coins for gas.
- **The internet**, unless `ONLINE=1`. MetaMask then runs without the
  settings it normally downloads and marks its signature window
  "Security check unavailable". No chain is reachable, so nothing after
  the signature (balances, the transaction) is tested here.
- **MetaMask's popup.** A headless browser opens none; the same page
  is opened as a tab.
- **MetaMask's update.** The browser's own updater is not used: between
  the two lectures the extension's files are replaced by today's build
  and the browser's copy of the old background script is dropped, which
  is what an update leaves behind. The wallet the older build stored is
  untouched.
- **Leaving the tab.** An automated browser keeps every tab visible and
  in focus, so the second install test sends the page the two signals
  for "left" and "came back" by hand. The reload that follows is real.

## What is not tested

Nothing here is covered by any test, and a MetaMask change in any of it
would pass unnoticed:

- **Other browsers and devices.** Only Chromium. Not the Chrome of the
  day, Brave, Edge or Firefox, and not MetaMask's mobile app.
- **What happens after the signature.** The real backend's other
  checks (cooldown, balances), the transaction, the student's balance
  shown on the page — all of it needs a chain, and the tests have none.
- **What a student does inside MetaMask.** Switching the account or the
  network in the wallet itself, disconnecting the site there, a second
  account, an imported or hardware account, a wallet restored from a
  secret phrase. The vitest suite covers the page's side of these with
  its stand-in wallet only.
- **Saying no**, except to the repair's connect window: declining the
  first connect, a network, a signature or a token.
- **A request already waiting in MetaMask** when the student presses a
  button again.
- **Other wallets.** Phantom and the Sui wallets (the Solana and Sui
  pages), and other wallets that answer on the EVM pages.
- **MetaMask's own servers**, without `ONLINE=1`, and the settings they
  hand out to some users before others, even with it.
- **Wallets older than the older build**, and the browser's real
  updater.
- **MetaMask in another language.** The windows are recognised by
  their English text; a student's MetaMask in Lithuanian behaves the
  same but was never looked at.
- **Other sites of the lecture.** A change in MetaMask that breaks the
  faucet may break Remix or a student's own page in the same hour;
  only the faucet is tested.

## Keeping it working

- **Playwright's version is written in two places** that must agree:
  the image tag in `../../Dockerfile.metamask` and `@playwright/test` in
  `package.json`. A runner of another version looks for a Chromium the
  image does not have.
- **The image's Chromium grows old.** The store serves MetaMask only
  to a browser new enough for it: 13.56 asks for Chrome 123, the image
  has Chromium 141. The day MetaMask asks for more than the image has,
  building the image stops with "The Chrome Web Store has no MetaMask
  for Chromium …" — it never falls back to an older MetaMask quietly.
  Move both Playwright versions to a newer release then.
- **The older build is a choice.** `METAMASK_PREVIOUS` (13.54.0 in
  `../../Dockerfile.metamask` and the run script) is the MetaMask the
  returning student's wallet is made under. 13.54 is the last release
  before 13.55 changed how MetaMask checks who may sign. At the start
  of a semester, set it to the release students install at the first
  lecture — the wallets of that semester are made by it.
- **`backend/` holds the real backend's answers**, taken on 12 and
  13 November 2026. Take them again after adding or changing an EVM
  network or a token, so the wallet is handed what students get (from
  this folder):

  ```sh
  FAUCET=https://…                                   # the running faucet
  curl -s $FAUCET/api/faucet/catalog             | python3 -m json.tool > backend/faucet-catalog.json
  curl -s $FAUCET/api/evm/networks               | python3 -m json.tool > backend/evm-networks.json
  curl -s $FAUCET/api/evm/sepolia/faucet-balance | python3 -m json.tool > backend/evm-faucet-balance.json
  curl -s $FAUCET/api/erc20/token/LINK           | python3 -m json.tool > backend/erc20-token-LINK.json
  curl -s $FAUCET/api/erc20/token/FOLD           | python3 -m json.tool > backend/erc20-token-FOLD.json
  ```

  `tests/networks.spec.mjs` reads its list of networks from the second
  file, so a new network is claimed on without a new test. The token
  answers are asked WITHOUT an address; the double adds the wallet's
  gas itself.
- **The claim sentence is written three times**: in the backend, in the
  page's wallet hook and in `support/faucet-double.mjs`, which checks
  signatures against it. Reword it in all three or every claim here is
  refused.

## Layout

| Path | What lives there |
|---|---|
| `tests/` | The five test files above |
| `support/browser.mjs` | Chromium with or without the extension, on a fresh or a kept profile; installing an extension into a running browser; reading MetaMask's pages |
| `support/metamask.mjs` | Making the wallet, picking it up after a restart, answering MetaMask's windows and its lock screen, reading its record |
| `support/moves.mjs` | What a student does on the page: reach the claim button, sign the claim |
| `support/faucet-double.mjs` | The site and the backend's double |
| `support/test.mjs` | The fixtures: `faucet`, `student` (has MetaMask, can come back), `visitor` (has none) |
| `support/announce.mjs` | The first lines of a run |
| `backend/` | The kept answers |
| `fetch-metamask.mjs` | Downloads and unpacks a MetaMask build while the image is built |
| `playwright.config.js` | Four tests side by side, minutes per test, one retry |
