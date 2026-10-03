############################################################
#  [*] Failure reason tests
#
#  The reasons a student — and the lecturer reading over
#  their shoulder — see when a claim or a balance read fails
#  on the chain's side: every transport failure told by what
#  the server did, the known node and contract refusals
#  translated with the node's own words kept, the unknown
#  ones passed on in those words, the chain clients' own
#  complaints, and the last resort of the exception's type
#  and message. The transaction graph's explorer gets the
#  same for Etherscan — its refusals, named for the server
#  that answered — and for the SQLite database behind the
#  graph. Two promises hold across all of them: a registered
#  secret never survives into a reason, and a reason never
#  outgrows its bound.
#
#  The exceptions are built exactly the way the libraries and
#  the chain clients raise them; nothing talks to a network.
#  The FOLD revert is the one Sepolia answered for a real
#  transfer from the faucet's wallet; the Etherscan refusals
#  are the result texts its API answers with status 0.
############################################################


import ssl
import socket
import sqlite3
import unittest

import requests
from web3.exceptions import ContractCustomError, ContractLogicError, ContractPanicError, Web3RPCError

from app.env_secrets import remember_secret
from app.failure_reasons import REASON_CHARS, describe_failure, failure_sentence


# FOLD's revert before its token generation event: the custom
# error TransferRestricted(from, to) with the faucet's wallet
# and the recipient as its arguments
FOLD_REVERT = ('0xcede7487'
               '00000000000000000000000087efe7dfb3b49162385bbe36ec0f3e5f3b41ed7d'
               '0000000000000000000000001212121212121212121212121212121212121212')

# Bitcoin Core's reject text as Electrum relays it
ELECTRUM_REJECT = ("Electrum error: {'code': 1, 'message': 'the transaction was rejected by network rules.\\n\\n"
                   "bad-txns-inputs-missingorspent\\n[0200]'}")


def http_error(status):
    response = requests.Response()
    response.status_code = status
    return requests.HTTPError(f'{status} Error for url: http://rpc.example/v3/key', response=response)


def rpc_error(message):
    return Web3RPCError(message, rpc_response={'jsonrpc': '2.0', 'id': 1, 'error': {'code': -32000, 'message': message}})


def etherscan_refusal(result):
    # How the graph explorer raises Etherscan's status-0 answer
    return RuntimeError(f'Etherscan API error: {result}')








############################################################
# TransportReasonTests
############################################################
#
# A failure on the way to the server, told by what the server
# did — in the case the sentence needs, with the client's own
# timeout when it waited in vain.
############################################################

class TransportReasonTests(unittest.TestCase):

    def test_an_http_status_names_what_the_server_said(self):
        for status, reason in (
            (401, 'tinklo RPC serveris atmetė prieigos raktą (HTTP 401)'),
            (403, 'tinklo RPC serveris atmetė prieigos raktą (HTTP 403)'),
            (404, 'tinklo RPC serveris nerado užklausto adreso (HTTP 404)'),
            (429, 'tinklo RPC serveris riboja užklausų skaičių (HTTP 429)'),
            (503, 'tinklo RPC serveris patyrė vidinę klaidą (HTTP 503)'),
            (418, 'tinklo RPC serveris grąžino klaidą (HTTP 418)'),
        ):
            with self.subTest(status=status):
                self.assertEqual(describe_failure(http_error(status), 'rpc', 10), reason)

    def test_a_timeout_says_how_long_the_client_waited(self):
        self.assertEqual(describe_failure(requests.ReadTimeout('read timed out'), 'rpc', 10),
                         'tinklo RPC serveris neatsakė per 10 s')
        self.assertEqual(describe_failure(socket.timeout('timed out'), 'electrum', 15),
                         'Electrum serveris neatsakė per 15 s')

    def test_a_connect_timeout_is_no_connection_not_a_silent_server(self):
        # requests' connect timeout is a timeout AND a connection error
        self.assertEqual(describe_failure(requests.ConnectTimeout('connect timed out'), 'graphql', 20),
                         'nepavyko prisijungti prie Sui GraphQL serverio per 20 s')

    def test_a_tls_failure_is_named(self):
        self.assertEqual(describe_failure(requests.exceptions.SSLError('bad handshake'), 'rpc', 10),
                         'nepavyko užmegzti saugaus ryšio su tinklo RPC serveriu (TLS)')
        self.assertEqual(describe_failure(ssl.SSLError('wrong version number'), 'electrum', 15),
                         'nepavyko užmegzti saugaus ryšio su Electrum serveriu (TLS)')

    def test_an_unreachable_server_is_no_connection(self):
        for error in (ConnectionRefusedError(111, 'Connection refused'), socket.gaierror(-2, 'Name or service not known')):
            with self.subTest(error=type(error).__name__):
                self.assertEqual(describe_failure(error, 'electrum', 15), 'nepavyko prisijungti prie Electrum serverio')
        self.assertEqual(describe_failure(requests.ConnectionError('Max retries exceeded'), 'graphql', 20),
                         'nepavyko prisijungti prie Sui GraphQL serverio')

    def test_a_dropped_connection_is_named(self):
        # The second is the Electrum client's own words for an EOF
        for error in (ConnectionResetError(104, 'Connection reset by peer'), ConnectionError('Connection closed by server')):
            with self.subTest(error=str(error)):
                self.assertEqual(describe_failure(error, 'electrum', 15), 'Electrum serveris nutraukė ryšį')

    def test_a_call_without_a_timeout_of_its_own_names_no_wait(self):
        self.assertEqual(describe_failure(TimeoutError('timed out'), 'database'), 'duomenų bazė neatsakė')
        self.assertEqual(describe_failure(requests.ConnectTimeout('connect timed out'), 'etherscan'),
                         'nepavyko prisijungti prie Etherscan serverio')








############################################################
# RefusalReasonTests
############################################################
#
# The chain's own refusals: an EVM node's JSON-RPC error, a
# token contract's revert, and the node answers the Solana,
# Sui and Electrum clients raise with the node's words
# inside. Known ones are translated with those words in
# parentheses; unknown ones are passed on.
############################################################

class RefusalReasonTests(unittest.TestCase):

    def test_a_known_evm_refusal_is_translated_with_its_words_kept(self):
        self.assertEqual(describe_failure(rpc_error('insufficient funds for gas * price + value: balance 0'), 'rpc', 10),
                         'čiaupo piniginėje nepakanka lėšų sumai ir tinklo mokesčiui padengti '
                         '(insufficient funds for gas * price + value: balance 0)')

    def test_the_specific_phrase_wins_over_the_general_one(self):
        self.assertEqual(describe_failure(rpc_error('replacement transaction underpriced'), 'rpc', 10),
                         'tinkle dar laukia ankstesnė čiaupo transakcija tuo pačiu eilės numeriu '
                         '(replacement transaction underpriced)')
        self.assertEqual(describe_failure(rpc_error('transaction underpriced'), 'rpc', 10),
                         'pasiūlytas mokestis per mažas šiam tinklui (transaction underpriced)')

    def test_an_unknown_evm_refusal_is_passed_on(self):
        self.assertEqual(describe_failure(rpc_error('header not found'), 'rpc', 10),
                         'tinklo mazgas atsakė klaida: header not found')

    def test_folds_locked_transfers_are_named(self):
        self.assertEqual(describe_failure(ContractCustomError(FOLD_REVERT, data=FOLD_REVERT), 'rpc', 10),
                         'žetono sutartis kol kas neleidžia pervedimų (TransferRestricted)')

    def test_an_unknown_custom_error_is_given_by_its_selector(self):
        data = '0xdeadbeef' + '00' * 32
        self.assertEqual(describe_failure(ContractCustomError(data, data=data), 'rpc', 10),
                         'žetono sutartis atmetė pervedimą (klaida 0xdeadbeef)')

    def test_a_revert_message_is_quoted_and_a_bare_revert_said_so(self):
        self.assertEqual(describe_failure(ContractLogicError('execution reverted: ERC20: transfer amount exceeds balance'),
                                          'rpc', 10),
                         'žetono sutartis atmetė pervedimą (ERC20: transfer amount exceeds balance)')
        self.assertEqual(describe_failure(ContractLogicError('execution reverted'), 'rpc', 10),
                         'žetono sutartis atmetė pervedimą, nenurodžiusi priežasties')

    def test_a_contract_panic_is_named(self):
        panic = ContractPanicError('Panic error 0x11: Arithmetic underflow or overflow.', data='0x4e487b71')
        self.assertEqual(describe_failure(panic, 'rpc', 10),
                         'žetono sutarties vykdymas nutrūko (Panic error 0x11: Arithmetic underflow or overflow.)')

    def test_a_solana_refusal_is_read_out_of_the_clients_text(self):
        known = RuntimeError("Solana RPC error: {'code': -32002, 'message': "
                             "'Transaction simulation failed: Blockhash not found', 'data': {'logs': []}}")
        unknown = RuntimeError("Solana RPC error: {'code': -32600, 'message': 'Invalid request'}")

        self.assertEqual(describe_failure(known, 'rpc', 20),
                         'tinklas nebeatpažįsta transakcijos bloko maišos — transakcija paseno '
                         '(Transaction simulation failed: Blockhash not found)')
        self.assertEqual(describe_failure(unknown, 'rpc', 20), 'tinklo mazgas atsakė klaida: Invalid request')

    def test_a_sui_refusal_is_read_out_of_the_clients_text(self):
        self.assertEqual(describe_failure(RuntimeError('Sui transaction failed: InsufficientCoinBalance'), 'graphql', 20),
                         'čiaupo monetų balanso nepakanka (InsufficientCoinBalance)')
        # GraphQL's errors come as a list of objects
        self.assertEqual(describe_failure(RuntimeError("Sui GraphQL error: [{'message': 'Rate limited', 'locations': []}]"),
                                          'graphql', 20),
                         'Sui GraphQL serveris atsakė klaida: Rate limited')

    def test_a_node_rejection_through_electrum_is_its_reason_line(self):
        self.assertEqual(describe_failure(RuntimeError(ELECTRUM_REJECT), 'electrum', 15),
                         'čiaupo monetos, kurias bandyta išleisti, jau išleistos arba tinklas jų dar nemato '
                         '(bad-txns-inputs-missingorspent)')

    def test_the_nodes_own_words_are_read_out_of_electrumxs_wrapper(self):
        # ElectrumX passes the node's error on inside its own
        error = RuntimeError("Electrum error: {'code': 2, 'message': \"daemon error: DaemonError({'code': -5, "
                             "'message': 'No such mempool transaction. Use -txindex or provide a block hash to "
                             "enable blockchain transaction queries.'})\"}")
        self.assertEqual(describe_failure(error, 'electrum', 15),
                         'tinklo mazgas neturi transakcijų indekso, todėl ieško tik tinklo eilėje, o ne blokuose '
                         '(No such mempool transaction. Use -txindex or provide a block hash to enable blockchain '
                         'transaction queries.)')

    def test_a_node_still_indexing_is_told_before_not_found(self):
        error = RuntimeError("Electrum error: {'code': 2, 'message': \"daemon error: DaemonError({'code': -5, "
                             "'message': 'No such mempool or blockchain transaction. Blockchain transactions are "
                             "still in the process of being indexed.'})\"}")
        self.assertEqual(describe_failure(error, 'electrum', 15),
                         'tinklo mazgas dar indeksuoja blokų transakcijas (No such mempool or blockchain '
                         'transaction. Blockchain transactions are still in the process of being indexed.)')

    def test_an_electrum_complaint_is_the_servers_not_the_nodes(self):
        # No network-rules wrapper: the Electrum server itself said no
        error = RuntimeError("Electrum error: {'code': 2, 'message': 'excessive resource usage'}")
        self.assertEqual(describe_failure(error, 'electrum', 15),
                         'Electrum serveris atsakė klaida: excessive resource usage')








############################################################
# EtherscanReasonTests
############################################################
#
# Why the graph explorer's refresh failed: Etherscan's own
# refusals (HTTP 200, status 0, the reason in its result)
# translated with its words kept, the unknown ones passed
# on, the transport failures told with the explorer's 20 s
# wait — each in the name of the server that answered,
# Etherscan or another block explorer's API.
############################################################

class EtherscanReasonTests(unittest.TestCase):

    def test_etherscans_known_refusals_are_translated_with_its_words_kept(self):
        for result, reason in (
            ('Invalid API Key', 'Etherscan serveris atmetė čiaupo operatoriaus API raktą (Invalid API Key)'),
            ('Missing/Invalid API Key', 'Etherscan serveris atmetė čiaupo operatoriaus API raktą (Missing/Invalid API Key)'),
            ('Max rate limit reached', 'Etherscan serveris riboja užklausų skaičių (Max rate limit reached)'),
            ('Max calls per sec rate limit reached (5/sec)',
             'Etherscan serveris riboja užklausų skaičių (Max calls per sec rate limit reached (5/sec))'),
            ('Max daily rate limit reached', 'Etherscan serveris riboja užklausų skaičių per parą (Max daily rate limit reached)'),
            ('Query Timeout occured. Please select a smaller result dataset',
             'Etherscan serveris nespėjo įvykdyti užklausos '
             '(Query Timeout occured. Please select a smaller result dataset)'),
            ('Missing or unsupported chainid parameter (required for v2 api)',
             'Etherscan serveris nepalaiko šio tinklo (Missing or unsupported chainid parameter (required for v2 api))'),
            ('Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage.',
             'čiaupo operatoriaus API rakto planas neapima šio tinklo (Free API access is not supported for this '
             'chain. Please upgrade your api plan for full chain coverage.)'),
            ('You are using a deprecated V1 endpoint, switch to Etherscan API V2',
             'čiaupo konfigūracijoje nurodytas nebepalaikomas API adresas '
             '(You are using a deprecated V1 endpoint, switch to Etherscan API V2)'),
        ):
            with self.subTest(result=result):
                self.assertEqual(describe_failure(etherscan_refusal(result), 'etherscan', 20), reason)

    def test_an_unknown_refusal_is_passed_on_in_etherscans_words(self):
        self.assertEqual(describe_failure(etherscan_refusal('Error! Invalid address format'), 'etherscan', 20),
                         'Etherscan serveris atsakė klaida: Error! Invalid address format')

    def test_another_explorers_api_is_named_as_a_block_explorers(self):
        self.assertEqual(describe_failure(etherscan_refusal('Max rate limit reached'), 'explorer', 20),
                         'blokų naršyklės API serveris riboja užklausų skaičių (Max rate limit reached)')
        self.assertEqual(describe_failure(requests.ReadTimeout('read timed out'), 'explorer', 20),
                         'blokų naršyklės API serveris neatsakė per 20 s')

    def test_a_transport_failure_is_told_in_etherscans_name(self):
        for error, reason in (
            (http_error(502), 'Etherscan serveris patyrė vidinę klaidą (HTTP 502)'),
            (http_error(429), 'Etherscan serveris riboja užklausų skaičių (HTTP 429)'),
            (requests.ReadTimeout('read timed out'), 'Etherscan serveris neatsakė per 20 s'),
            (requests.ConnectTimeout('connect timed out'), 'nepavyko prisijungti prie Etherscan serverio per 20 s'),
            (requests.ConnectionError('Max retries exceeded'), 'nepavyko prisijungti prie Etherscan serverio'),
            (requests.exceptions.SSLError('bad handshake'), 'nepavyko užmegzti saugaus ryšio su Etherscan serveriu (TLS)'),
        ):
            with self.subTest(error=type(error).__name__):
                self.assertEqual(describe_failure(error, 'etherscan', 20), reason)

    def test_an_answer_in_another_shape_is_said_to_be_one(self):
        self.assertEqual(describe_failure(ValueError('Unexpected Etherscan answer: not JSON'), 'etherscan', 20),
                         'Etherscan serveris atsakė netikėto formato duomenimis')

    def test_the_whole_sentence_reads_as_the_graph_shows_it(self):
        self.assertEqual(failure_sentence('Nepavyko atnaujinti transakcijų sąrašo', etherscan_refusal('Invalid API Key'),
                                          'etherscan', 20),
                         'Nepavyko atnaujinti transakcijų sąrašo: Etherscan serveris atmetė čiaupo operatoriaus '
                         'API raktą (Invalid API Key).')








############################################################
# DatabaseReasonTests
############################################################
#
# The SQLite database behind the graph, told by its own
# message: the known complaints translated with its words
# kept, any other passed on in them.
############################################################

class DatabaseReasonTests(unittest.TestCase):

    def test_sqlites_known_complaints_are_translated_with_its_words_kept(self):
        for error, reason in (
            (sqlite3.OperationalError('database is locked'),
             'duomenų bazė užrakinta kitos rašančios užklausos (database is locked)'),
            (sqlite3.OperationalError('attempt to write a readonly database'),
             'duomenų bazė atverta tik skaitymui (attempt to write a readonly database)'),
            (sqlite3.OperationalError('database or disk is full'), 'serverio diske nebeliko vietos (database or disk is full)'),
            (sqlite3.OperationalError('disk I/O error'), 'nepavyko perskaityti ar įrašyti duomenų bazės failo (disk I/O error)'),
            (sqlite3.OperationalError('unable to open database file'),
             'nepavyko atverti duomenų bazės failo (unable to open database file)'),
            (sqlite3.DatabaseError('database disk image is malformed'),
             'duomenų bazės failas sugadintas (database disk image is malformed)'),
            (sqlite3.OperationalError('no such table: Graph_Transactions'),
             'duomenų bazėje trūksta lentelės (no such table: Graph_Transactions)'),
            (sqlite3.OperationalError('no such column: is_hub'), 'duomenų bazės lentelėje trūksta stulpelio (no such column: is_hub)'),
        ):
            with self.subTest(error=str(error)):
                self.assertEqual(describe_failure(error, 'database'), reason)

    def test_an_unknown_complaint_is_passed_on_in_sqlites_words(self):
        self.assertEqual(describe_failure(sqlite3.IntegrityError('UNIQUE constraint failed: Graph_Addresses.address'),
                                          'database'),
                         'duomenų bazė atsakė klaida: UNIQUE constraint failed: Graph_Addresses.address')

    def test_the_whole_sentence_names_what_could_not_be_done(self):
        self.assertEqual(failure_sentence('Nepavyko gauti dienų sąrašo', sqlite3.OperationalError('database is locked'),
                                          'database'),
                         'Nepavyko gauti dienų sąrašo: duomenų bazė užrakinta kitos rašančios užklausos (database is locked).')








############################################################
# ClientAndFallbackTests
############################################################
#
# The chain clients' own complaints, told in the server's
# terms, and the last resort for anything unrecognized.
############################################################

class ClientAndFallbackTests(unittest.TestCase):

    def test_a_client_complaint_is_told_in_the_servers_terms(self):
        for error, server, reason in (
            (ValueError('Electrum server not configured'), 'electrum', 'Electrum serveris nesukonfigūruotas'),
            (ValueError('Unexpected Solana RPC response format'), 'rpc',
             'tinklo RPC serveris atsakė netikėto formato duomenimis'),
            (ValueError('Electrum reply for another request'), 'electrum',
             'Electrum serveris atsakė netikėto formato duomenimis'),
            (ValueError('Faucet private key not configured'), 'electrum', 'čiaupo privatus raktas nesukonfigūruotas'),
        ):
            with self.subTest(error=str(error)):
                self.assertEqual(describe_failure(error, server, 15), reason)

    def test_anything_else_is_its_type_and_message(self):
        self.assertEqual(describe_failure(ValueError('Invalid recipient address'), 'electrum', 15),
                         'ValueError: Invalid recipient address')
        self.assertEqual(describe_failure(KeyError('balance'), 'rpc', 10), "KeyError: 'balance'")
        self.assertEqual(describe_failure(RuntimeError(), 'rpc', 10), 'RuntimeError: be aprašymo')








############################################################
# PromiseTests
############################################################
#
# What holds for every reason: secrets scrubbed, the length
# bounded, and the sentence around it punctuated once.
############################################################

class PromiseTests(unittest.TestCase):

    def test_a_registered_secret_never_survives(self):
        remember_secret('slaptas-raktas-123')

        self.assertEqual(describe_failure(RuntimeError('POST /v3/slaptas-raktas-123 failed'), 'rpc', 10),
                         'RuntimeError: POST /v3/<redacted> failed')
        self.assertNotIn('slaptas-raktas-123', describe_failure(rpc_error('bad key slaptas-raktas-123'), 'rpc', 10))

    def test_the_etherscan_key_never_survives(self):
        # The explorer registers its key; requests puts it into
        # the URL of its errors, and a refusal could echo it
        remember_secret('etherscan-raktas-456')

        self.assertEqual(describe_failure(RuntimeError('GET /api?module=account&apikey=etherscan-raktas-456 failed'),
                                          'etherscan', 20),
                         'RuntimeError: GET /api?module=account&apikey=<redacted> failed')
        self.assertEqual(describe_failure(etherscan_refusal('Invalid API Key etherscan-raktas-456'), 'etherscan', 20),
                         'Etherscan serveris atmetė čiaupo operatoriaus API raktą (Invalid API Key <redacted>)')

    def test_a_secret_is_scrubbed_in_its_url_encoded_spelling_too(self):
        # requests percent-encodes the URL it puts into its errors
        remember_secret('raktas-ąčę')
        error = RuntimeError('Max retries exceeded with url: /v3/raktas-%C4%85%C4%8D%C4%99')

        self.assertEqual(describe_failure(error, 'rpc', 10),
                         'RuntimeError: Max retries exceeded with url: /v3/<redacted>')

    def test_a_reason_stays_within_its_bound(self):
        # A Solana refusal can drag its program's whole log along
        flood = RuntimeError("Solana RPC error: {'code': -32002, 'message': '" + 'log line ' * 500 + "'}")
        reason = describe_failure(flood, 'rpc', 20)

        self.assertLessEqual(len(reason), REASON_CHARS)
        self.assertTrue(reason.endswith('…'))

    def test_the_sentence_ends_once_and_carries_the_next_step(self):
        self.assertEqual(failure_sentence('Tinklas nepasiekiamas', requests.ConnectionError('refused'), 'rpc', 10,
                                          then='Bandykite vėliau.'),
                         'Tinklas nepasiekiamas: nepavyko prisijungti prie tinklo RPC serverio. Bandykite vėliau.')
        # A reason that already ends a sentence gets no second full stop
        self.assertEqual(failure_sentence('Nepavyko išsiųsti transakcijos', rpc_error('Invalid params.'), 'rpc', 10),
                         'Nepavyko išsiųsti transakcijos: tinklo mazgas atsakė klaida: Invalid params.')


if __name__ == '__main__':
    unittest.main()
