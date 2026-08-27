############################################################
#  [*] Config model tests
#
#  Proves the pydantic schema actually catches the mistakes
#  it exists for: misspelled keys, missing sections, bad
#  addresses, tokens on unknown networks, duplicate ids. The
#  positive case is implicit — importing the config loader
#  (test_configs) validates the REAL configs — but it's asserted explicitly
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

    def svm(self, mutate=None):
        # A fresh valid SVM config, optionally broken by `mutate`
        configs = copy.deepcopy(helpers.SVM_TEST_CONFIGS)
        if mutate:
            mutate(configs)
        return configs

    def move(self, mutate=None):
        # A fresh valid MOVE config, optionally broken by `mutate`
        configs = copy.deepcopy(helpers.MOVE_TEST_CONFIGS)
        if mutate:
            mutate(configs)
        return configs

    def test_real_configs_validate(self):
        # the loader already validated at import; re-validating the
        # normalized output must also pass (idempotent)
        from app import config_loader
        validate_configs(config_loader.EVM_NETWORK_CONFIGS, config_loader.ERC20_TOKEN_CONFIGS,
                         config_loader.UTXO_NETWORK_CONFIGS, config_loader.SVM_NETWORK_CONFIGS,
                         config_loader.MOVE_NETWORK_CONFIGS)

    def test_helper_fixtures_validate(self):
        # keep the test fixtures themselves honest
        validate_configs(helpers.EVM_TEST_CONFIGS, {}, helpers.UTXO_TEST_CONFIGS,
                         helpers.SVM_TEST_CONFIGS, helpers.MOVE_TEST_CONFIGS)

    def test_unknown_svm_chain_is_rejected(self):
        def mutate(c):
            c['testsvm']['faucet']['chain'] = 'aptos'  # not in the SVM registry
        with self.assertRaises(ValueError):
            validate_configs({}, {}, {}, self.svm(mutate), {})

    def test_unknown_svm_flavour_is_rejected(self):
        def mutate(c):
            c['testsvm']['faucet']['network'] = 'regtest'  # Solana has no such cluster
        with self.assertRaises(ValueError):
            validate_configs({}, {}, {}, self.svm(mutate), {})

    def test_unknown_move_chain_is_rejected(self):
        def mutate(c):
            c['testmove']['faucet']['chain'] = 'aptos'  # not in the MOVE registry
        with self.assertRaises(ValueError):
            validate_configs({}, {}, {}, {}, self.move(mutate))

    def test_unknown_move_flavour_is_rejected(self):
        def mutate(c):
            c['testmove']['faucet']['network'] = 'regtest'  # Sui has no such flavour
        with self.assertRaises(ValueError):
            validate_configs({}, {}, {}, {}, self.move(mutate))

    def test_sub_rent_exempt_chunk_is_rejected(self):
        # A chunk below the rent-exempt minimum funds an account
        # the runtime immediately reclaims — the student would
        # watch the balance vanish. Both numbers are known at boot,
        # so the boot is where it fails.
        def mutate(c):
            c['testsvm']['faucet']['chunk_size'] = 0.0001    # 100k lamports
        with self.assertRaises(ValueError) as caught:
            validate_configs({}, {}, {}, self.svm(mutate), {})
        self.assertIn('rent-exempt', str(caught.exception))

    def test_misspelled_key_is_rejected(self):
        # extra='forbid' — the whole point: 'chunk_sizee' must not
        # silently become a default somewhere
        def mutate(c):
            c['testchain']['faucet']['chunk_sizee'] = c['testchain']['faucet'].pop('chunk_size')
        with self.assertRaises(ValueError):
            validate_configs(self.evm(mutate), {}, {}, {}, {})

    def test_missing_section_is_rejected(self):
        def mutate(c):
            del c['testchain']['metamask']
        with self.assertRaises(ValueError):
            validate_configs(self.evm(mutate), {}, {}, {}, {})

    def test_bare_string_rpc_urls_is_rejected(self):
        # EIP-3085 wants arrays; a bare string must fail, not iterate chars
        def mutate(c):
            c['testchain']['metamask']['rpc_urls'] = 'http://public.example/rpc'
        with self.assertRaises(ValueError):
            validate_configs(self.evm(mutate), {}, {}, {}, {})

    def test_malformed_contract_address_is_rejected(self):
        tokens = copy.deepcopy(helpers.ERC20_TEST_CONFIGS)
        tokens['TST']['deployments'] = {'testchain': '0x1234'}
        with self.assertRaises(ValueError):
            validate_configs(self.evm(), tokens, {}, {}, {})

    def test_deployment_on_unknown_network_is_rejected(self):
        # This is exactly why helpers.ERC20_TEST_CONFIGS (with its
        # deliberate 'ghostchain') must NOT be fed to the validator
        with self.assertRaises(ValueError):
            validate_configs(self.evm(), helpers.ERC20_TEST_CONFIGS, {}, {}, {})

    def test_duplicate_chain_id_is_rejected(self):
        def mutate(c):
            c['secondchain'] = copy.deepcopy(c['testchain'])
            c['secondchain']['id'] = 2  # unique id, duplicate chain_id
        with self.assertRaises(ValueError):
            validate_configs(self.evm(mutate), {}, {}, {}, {})

    def test_unknown_coin_is_rejected(self):
        utxo = copy.deepcopy(helpers.UTXO_TEST_CONFIGS)
        utxo['knf']['faucet']['coin'] = 'shibacoin'  # not in the registry
        with self.assertRaises(ValueError):
            validate_configs({}, {}, utxo, {}, {})

    def test_error_names_the_broken_entry(self):
        def mutate(c):
            del c['testchain']['faucet']['rpc_url']
        with self.assertRaises(ValueError) as caught:
            validate_configs(self.evm(mutate), {}, {}, {}, {})
        self.assertIn("'testchain'", str(caught.exception))

    def test_optional_sections_normalize_away(self):
        # No explorer section -> key absent in output, so consumers'
        # .get('explorer', {}) chains keep working (None would crash them)
        def mutate(c):
            del c['testchain']['explorer']
        evm, _, _, _, _ = validate_configs(self.evm(mutate), {}, {}, {}, {})
        self.assertNotIn('explorer', evm['testchain'])

    def test_a_key_that_is_not_url_safe_fails_the_boot(self):
        # A map key becomes a URL segment, a page path and an icon
        # filename — a slash or a space boots green and 404s later
        for bad in ('my/chain', 'my chain', 'chain.v2', ''):
            with self.subTest(key=bad):
                with self.assertRaises(ValueError):
                    validate_configs({bad: self.evm()['testchain']}, {}, {}, {}, {})

    def test_url_safe_keys_pass(self):
        for good in ('sepolia', 'zkSync-Sepolia', 'btc_4', 'LINK'):
            with self.subTest(key=good):
                validate_configs({good: self.evm()['testchain']}, {}, {}, {}, {})

    def test_a_move_chunk_below_one_base_unit_fails_the_boot(self):
        # 5e-10 SUI is less than one MIST — the payout would be zero
        with self.assertRaises(ValueError):
            validate_configs({}, {}, {}, {}, self.move(lambda c: c['testmove']['faucet'].__setitem__('chunk_size', 5e-10)))

    def test_a_utxo_chunk_below_the_dust_limit_fails_the_boot(self):
        configs = copy.deepcopy(helpers.UTXO_TEST_CONFIGS)
        configs['btc4']['faucet']['chunk_size'] = 0.000001      # 100 sat, dust limit is 546
        with self.assertRaises(ValueError) as caught:
            validate_configs({}, {}, configs, {}, {})
        self.assertIn('dust', str(caught.exception))

    def test_an_impossible_electrum_port_fails_the_boot(self):
        configs = copy.deepcopy(helpers.UTXO_TEST_CONFIGS)
        configs['btc4']['faucet']['electrum_server'] = '127.0.0.1:99999'
        with self.assertRaises(ValueError):
            validate_configs({}, {}, configs, {}, {})



if __name__ == '__main__':
    unittest.main()
