# Backend regression tests

Three layers, from cheapest to heaviest:

| Layer | Files | Needs network? | When to run |
|---|---|---|---|
| Config invariants | `test_configs.py` | no | always |
| Offline regression | `test_utxo_engine.py`, `test_evm_faucet.py`, `test_erc20_faucet.py` | no | always |
| Live smoke | `integration/test_live_smoke.py` | yes (running backend) | opt-in via `RUN_LIVE=1` |

The offline layers are the safety net: they must pass with no internet,
no Electrum server and no Infura key. The crown jewel is
`test_utxo_engine.py` — it pins the embit transaction builder to byte
anchors recorded during the bitcoinlib→embit migration (the legacy
engine and embit produced the IDENTICAL txid for the same inputs), so
any change that alters payout bytes fails loudly.

## Running

Inside the live dev container (source is mounted at /app):

    sudo docker exec -w /app faucet-backend python -m unittest discover -s tests -v

Including the live smoke layer (backend must be up):

    sudo docker exec -w /app -e RUN_LIVE=1 faucet-backend python -m unittest discover -s tests -v

From a fresh container (after the image has been rebuilt with embit):

    sudo docker run --rm -v ./backend:/b -w /b faucet-backend python -m unittest discover -s tests -v

## Conventions

- Offline by default: a test that talks to the network belongs under
  `integration/` and must skip itself unless `RUN_LIVE=1` is set.
- Never import the route modules (`evm_routes`, `erc20_routes`,
  `utxo_routes`) — they build live faucet instances (with warmups) at
  import time. Import the class modules and build instances through
  `helpers.py`, which patches the warmups out and injects a throwaway
  key. NEVER put the real faucet key in a test.
- Test configs and byte anchors live in `helpers.py`; if a deliberate
  behavior change breaks an anchor, re-record it there in one place and
  say so in the commit message.
- Style: test files carry the house file/class banners, but test
  methods use a one-line comment and single blank lines instead of full
  method banners — a test's name is its documentation.
