# Backend regression tests

Four layers, from cheapest to heaviest:

| Layer | Files | Needs network? | When to run |
|---|---|---|---|
| Config invariants | `test_configs.py`, `test_config_models.py` | no | always |
| Offline regression | `test_utxo_engine.py`, `test_electrum_client.py`, `test_evm_faucet.py`, `test_erc20_faucet.py`, `test_svm_faucet.py`, `test_move_faucet.py`, `test_sui_graphql_client.py`, `test_solana_rpc_client.py`, `test_request_flows.py`, `test_explorer.py`, `test_cooldown.py` | no | always |
| Pinned defects | `test_evm_defects.py`, `test_erc20_defects.py`, `test_utxo_defects.py`, `test_electrum_defects.py`, `test_svm_defects.py`, `test_move_defects.py`, `test_cooldown_defects.py`, `test_explorer_defects.py`, `test_core_defects.py` | no | always — every test is an expected failure |
| Live smoke | `integration/test_live_smoke.py` | yes (running backend) | opt-in via `RUN_LIVE=1` |

The offline layers are the safety net: they must pass with no internet,
no Electrum server and no Infura key. The crown jewel is
`test_utxo_engine.py` — it pins the embit transaction builder to byte
anchors recorded during the bitcoinlib→embit migration (the legacy
engine and embit produced the IDENTICAL txid for the same inputs), so
any change that alters payout bytes fails loudly.

## Running

Against the WORKING TREE, in a throwaway container (from the repo
root — the config mount is required, `main` loads `_CONFIG/coins.py`):

    sudo docker run --rm -v ./backend:/b:ro -v ./_CONFIG:/config:ro -w /b faucet-backend python -m unittest discover -s tests -v

Inside the running container — this tests the working tree ONLY when
the `./backend:/app` dev mount is enabled in docker-compose.yml;
otherwise it tests the source baked into the image:

    sudo docker exec -w /app faucet-backend python -m unittest discover -s tests -v

Including the live smoke layer (backend must be up):

    sudo docker exec -w /app -e RUN_LIVE=1 faucet-backend python -m unittest discover -s tests -v

## Conventions

- Offline by default: a test that talks to the network belongs under
  `integration/` and must skip itself unless `RUN_LIVE=1` is set.
- Never import the route modules (`evm_routes`, `erc20_routes`,
  `utxo_routes`, `svm_routes`, `move_routes`, `catalog_routes`) — they
  build live faucet instances (with warmups) at
  import time. Import the class modules and build instances through
  `helpers.py`, which patches the warmups out and injects a throwaway
  key. NEVER put the real faucet key in a test.
- Test configs and byte anchors live in `helpers.py`; if a deliberate
  behavior change breaks an anchor, re-record it there in one place and
  say so in the commit message.
- Style: test files carry the house file/class banners, but test
  methods use a one-line comment and single blank lines instead of full
  method banners — a test's name is its documentation.
- A defect found by review but not yet fixed gets its regression test
  UP FRONT, in `test_<area>_defects.py`, decorated
  `@unittest.expectedFailure`: the test states the wanted behavior and
  fails today. Once the fix lands, unittest reports it as an "unexpected
  success" — which fails the run — and that is the cue to drop the
  decorator and move the test into its home file.
