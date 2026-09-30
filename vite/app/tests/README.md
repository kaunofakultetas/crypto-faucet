# Frontend tests

The vitest suite of the faucet SPA: every page, component and hook
rendered in jsdom against a fake backend (msw), with no real backend,
wallet, browser or network anywhere.

## Running

```sh
../runTests.sh                      # the whole suite, in a throwaway container
../runTests.sh tests/pages          # a folder, a file, or -t "test name"
```

`runTests.sh` builds the builder stage of the production Dockerfile
(so `npm run build` must pass first) and runs vitest in it — the host
needs no node. While developing, the running dev container is quicker:

```sh
sudo docker exec -it -w /app -e TMPDIR=/app/node_modules/.tmp faucet-vite npx vitest run tests/pages/faucet-utxo.test.jsx
```

(its root filesystem is read-only, so vitest's temp files go under
`node_modules/.tmp` — on disk, ignored by git and docker; not `/dev/shm`,
whose 64 MB fill up after a few dozen runs). `npx eslint tests` lints
the suite like the app.

## Layout

| Folder | What lives there |
|---|---|
| `support/` | The harness: `setup.js` (polyfills, the backend double's lifecycle, the per-test slate, the console and unhandled-request guards), `render.jsx` (`renderPage`, `renderApp`), `location.js`, `backend/` (the msw server with `given.*`, the default `handlers.js`, `fixtures.js`, the `contract.js` matrix) and the wallet doubles |
| `core/` | The app as a whole: the harness smoke test, structural rules (every backend call has a handler …), App routing and titles, the error boundary |
| `components/` | Shared components: Navbar, FaucetPicker, AssetIcon, UniversalModal, WalletFlow, Footer, ErrorCard |
| `hooks/` | The wallet hooks (MetaMask, Phantom, Sui) against wallet doubles |
| `pages/` | One file per page (a folder for the big ones), behaviour plus the backend contract of every endpoint the page reads |
| `contract/` | The route sweep: every route under every backend failure mode |

## Rules

- **Nothing real.** Every request goes to the msw double. A request no
  handler answers fails the test — add a default handler in
  `support/backend/handlers.js` (a new endpoint in `src/`) or answer it
  in the test with `given.*`. `core/structural.test.js` checks every
  call in `src/` has a default handler.
- **Declare only the deviation.** Default handlers answer the happy
  path from `fixtures.js`; a test overrides one endpoint with
  `given.json / error / html / networkError / hang / slow / capture /
  sequence`. Fixtures are shared: copy and edit (`{ ...f.evmBalance(),
  balance: 0 }`), never mutate them.
- **Globals through `vi.stubGlobal`.** Wallet doubles (`window.ethereum`,
  `window.phantom`, the Sui wallet standard), `navigator.clipboard`,
  timers — all undone after each test by `setup.js`. localStorage is
  cleared after each test.
- **No bug fixed from here.** A test that finds a defect in `src/` does
  not change `src/`: it pins the defect with `it.fails` (the contract
  matrix's `pins`) and a one-line description, so the suite stays green
  while the bug is on record.
- **Assert what a student sees.** Roles, labels and the Lithuanian texts
  verbatim; no snapshots, no class names, no implementation internals
  unless the behaviour lives there (an SVG transform is how a dragged
  box's position shows).
- **Console discipline.** React's bug reports (a missing key, a hook
  order change …) and the app's own crash log fail the test; a test
  that crashes something on purpose declares it with
  `allowConsoleErrors(/…/)`.

## Practical notes

What the suite learned the hard way:

- **A module that remembers its wallet.** `useMetamaskWallet` keeps the
  first MetaMask it discovers for the life of the module. A test that
  changes wallets calls `vi.resetModules()` and re-imports the hook or
  page in `beforeEach` (see `hooks/use-metamask-wallet.test.jsx`).
- **Fake timers.** vitest's `vi.useFakeTimers()` also fakes
  `performance`, `requestAnimationFrame` and `hrtime` by default — pass
  an explicit `toFake` list. With `setTimeout` left real but
  `setInterval` faked, `waitFor` re-checks only on DOM changes.
- **Time zone.** `vi.stubEnv('TZ', 'Europe/Vilnius')` — undone after
  every test by `setup.js`.
- **Clipboard.** `userEvent.setup()` (inside `renderPage` / `renderApp`)
  installs its own clipboard on `navigator`; spy on
  `navigator.clipboard.writeText` rather than stubbing the global.
- **Dialogs.** An open MUI dialog hides the rest of the page from role
  queries (`aria-hidden`) — read the page behind it with
  `{ hidden: true }`.
- **Keyboard focus.** jsdom reports `:focus-visible` only when the focus
  came from a text field — tab from one to test a focus frame.
- **Re-rendering.** `renderPage(...).rerender(nextUi)` keeps the frame
  and the page's state; `installLocationDouble` under `renderApp` only
  after the app has rendered (see `support/location.js`).
- **Contract matrix.** `render` may be async (a click that triggers the
  request); the huge-list variant repeats entries with equal keys, so
  React's "two children with the same key" warning there is expected —
  that warning is deliberately not fatal.

## Style

The house style of the app: a file header banner saying what the file
covers, a banner per `describe` group, seven blank lines between
sections, two between tests; test names are sentences about behaviour
("shows the cooldown message the backend sends"), not method names.
