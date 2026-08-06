############################################################
#  [*] Config model tests
#
#  Proves the pydantic schema actually catches the mistakes
#  it exists for: misspelled keys, missing sections, bad
#  addresses, tokens on unknown networks, duplicate ids. The
#  positive case is implicit — importing main (test_configs)
#  validates the REAL configs — but it's asserted explicitly
#  here too, plus the helpers' fixtures are kept honest.
############################################################


import copy
import unittest

from app.config_models import validate_configs
from tests import helpers




############################################################
# ConfigModelTests
############################################################

class ConfigModelTests(unittest.TestCase):

    def evm(self, mutate=None):
        # A fresh valid EVM config, optionally broken by `mutate`
        configs = copy.deepcopy(helpers.EVM_TEST_CONFIGS)
        if mutate:
            mutate(configs)
        return configs

    def test_real_configs_validate(self):
        # main.py already validated at import; re-validating the
        # normalized output must also pass (idempotent)
        import main
        validate_configs(main.EVM_NETWORK_CONFIGS, main.ERC20_TOKEN_CONFIGS, main.UTXO_NETWORK_CONFIGS)

    def test_helper_fixtures_validate(self):
        # keep the test fixtures themselves honest
        validate_configs(helpers.EVM_TEST_CONFIGS, {}, helpers.UTXO_TEST_CONFIGS)

    def test_misspelled_key_is_rejected(self):
        # extra='forbid' — the whole point: 'chunk_sizee' must not
        # silently become a default somewhere
        def mutate(c):
            c['testchain']['faucet']['chunk_sizee'] = c['testchain']['faucet'].pop('chunk_size')
        with self.assertRaises(ValueError):
            validate_configs(self.evm(mutate), {}, {})

    def test_missing_section_is_rejected(self):
        def mutate(c):
            del c['testchain']['metamask']
        with self.assertRaises(ValueError):
            validate_configs(self.evm(mutate), {}, {})

    def test_bare_string_rpc_urls_is_rejected(self):
        # EIP-3085 wants arrays; a bare string must fail, not iterate chars
        def mutate(c):
            c['testchain']['metamask']['rpc_urls'] = 'http://public.example/rpc'
        with self.assertRaises(ValueError):
            validate_configs(self.evm(mutate), {}, {})

    def test_malformed_contract_address_is_rejected(self):
        tokens = copy.deepcopy(helpers.ERC20_TEST_CONFIGS)
        tokens['TST']['deployments'] = {'testchain': '0x1234'}
        with self.assertRaises(ValueError):
            validate_configs(self.evm(), tokens, {})

    def test_deployment_on_unknown_network_is_rejected(self):
        # This is exactly why helpers.ERC20_TEST_CONFIGS (with its
        # deliberate 'ghostchain') must NOT be fed to the validator
        with self.assertRaises(ValueError):
            validate_configs(self.evm(), helpers.ERC20_TEST_CONFIGS, {})

    def test_duplicate_chain_id_is_rejected(self):
        def mutate(c):
            c['secondchain'] = copy.deepcopy(c['testchain'])
            c['secondchain']['id'] = 2  # unique id, duplicate chain_id
        with self.assertRaises(ValueError):
            validate_configs(self.evm(mutate), {}, {})

    def test_unknown_coin_is_rejected(self):
        utxo = copy.deepcopy(helpers.UTXO_TEST_CONFIGS)
        utxo['knf']['faucet']['coin'] = 'shibacoin'  # not in the registry
        with self.assertRaises(ValueError):
            validate_configs({}, {}, utxo)

    def test_error_names_the_broken_entry(self):
        def mutate(c):
            del c['testchain']['faucet']['rpc_url']
        with self.assertRaises(ValueError) as caught:
            validate_configs(self.evm(mutate), {}, {})
        self.assertIn("'testchain'", str(caught.exception))

    def test_optional_sections_normalize_away(self):
        # No explorer section -> key absent in output, so consumers'
        # .get('explorer', {}) chains keep working (None would crash them)
        def mutate(c):
            del c['testchain']['explorer']
        evm, _, _ = validate_configs(self.evm(mutate), {}, {})
        self.assertNotIn('explorer', evm['testchain'])


if __name__ == '__main__':
    unittest.main()
