############################################################
#  [*] Failure reasons — what went wrong, in words
#
#  The faucet pages show the backend's error sentence word
#  for word, and in a lecture that sentence is how the room
#  learns what broke. So when a claim or a balance read fails
#  on the chain's side, a faucet says what it could not do
#  and adds the reason this module puts into words: the
#  server that did not answer in time, refused the access
#  key, limited the request rate or dropped the connection;
#  the node that rejected the transaction, and why; the token
#  contract that refused the transfer, and with which error.
#  The transaction graph's explorer says the same of its
#  Etherscan refresh — Etherscan's own refusals included —
#  and of the SQLite database it serves the graph from.
#
#  Known refusals are translated into Lithuanian with the
#  node's, the contract's, Etherscan's or the database's own
#  words kept in parentheses, so the exact cause stays
#  searchable. An unknown refusal is passed on in the node's
#  words, and any other failure falls back to the exception's
#  type and message.
#
#  Every reason is scrubbed of registered secrets on its way
#  out: the HTTP libraries put the full request URL into
#  their exception text — the Infura key in an RPC URL, the
#  Etherscan API key in the explorer's query string — and
#  these sentences reach every student's screen.
############################################################


import re
import ast
import ssl
import socket
import sqlite3

import requests
from web3 import Web3
from web3.exceptions import ContractCustomError, ContractLogicError, ContractPanicError, Web3RPCError

from .env_secrets import redact


# The servers a failing call can have talked to, in the three
# grammatical cases the sentences need: the one that did not
# answer, the one no connection reached, the one a secure
# connection failed with. 'etherscan' is the graph explorer's
# API where the network's explorer section points at
# Etherscan; 'explorer' is another Etherscan-style API
# (zkSync's, Linea's), which answers in Etherscan's shape but
# is not Etherscan — a sentence naming the wrong server sends
# the lecturer to the wrong status page. 'database' is the
# backend's own SQLite file, whose failures have their own
# table below.
SERVERS = {
    'rpc': ('tinklo RPC serveris', 'tinklo RPC serverio', 'tinklo RPC serveriu'),
    'graphql': ('Sui GraphQL serveris', 'Sui GraphQL serverio', 'Sui GraphQL serveriu'),
    'electrum': ('Electrum serveris', 'Electrum serverio', 'Electrum serveriu'),
    'etherscan': ('Etherscan serveris', 'Etherscan serverio', 'Etherscan serveriu'),
    'explorer': ('blokų naršyklės API serveris', 'blokų naršyklės API serverio', 'blokų naršyklės API serveriu'),
    'database': ('duomenų bazė', 'duomenų bazės', 'duomenų baze'),
}

# How much of a node's own message a reason quotes, and how
# long a whole reason may grow — a Solana refusal can carry
# its program's full log
QUOTE_CHARS = 200
REASON_CHARS = 400

# Refusals an EVM node words in plain English, by a phrase of
# its message. In every table the first match wins, so the
# specific phrases come before the general ones.
EVM_REFUSALS = (
    ('insufficient funds', 'čiaupo piniginėje nepakanka lėšų sumai ir tinklo mokesčiui padengti'),
    ('nonce too low', 'čiaupo transakcijos eilės numeris jau panaudotas — ankstesnė transakcija dar apdorojama'),
    ('replacement transaction underpriced', 'tinkle dar laukia ankstesnė čiaupo transakcija tuo pačiu eilės numeriu'),
    ('already known', 'ši transakcija jau yra tinklo eilėje'),
    ('max fee per gas less than block base fee', 'pasiūlytas mokestis mažesnis už dabartinį tinklo bazinį mokestį'),
    ('underpriced', 'pasiūlytas mokestis per mažas šiam tinklui'),
    ('intrinsic gas too low', 'transakcijai nurodytas per mažas dujų limitas'),
    ('exceeds block gas limit', 'dujų limitas viršija bloko limitą'),
)

SOLANA_REFUSALS = (
    ('blockhash not found', 'tinklas nebeatpažįsta transakcijos bloko maišos — transakcija paseno'),
    ('no record of a prior credit', 'čiaupo sąskaita šiame tinkle tuščia'),
    ('insufficient funds for rent', 'po pervedimo sąskaitoje liktų mažiau nei nuomos minimumas'),
    ('insufficient funds', 'čiaupo sąskaitoje nepakanka lėšų'),
    ('insufficient lamports', 'čiaupo sąskaitoje nepakanka lėšų'),
    ('node is behind', 'tinklo mazgas atsilieka nuo tinklo'),
    ('node is unhealthy', 'tinklo mazgas šiuo metu neveikia tvarkingai'),
)

SUI_REFUSALS = (
    ('insufficientgas', 'transakcijai pritrūko dujų'),
    ('gasbalancetoolow', 'čiaupui trūksta SUI tinklo mokesčiui'),
    ('balance of gas object', 'čiaupui trūksta SUI tinklo mokesčiui'),
    ('insufficientcoinbalance', 'čiaupo monetų balanso nepakanka'),
    ('not available for consumption', 'čiaupo moneta ką tik panaudota kitoje transakcijoje'),
    ('objectversionunavailableforconsumption', 'čiaupo moneta ką tik panaudota kitoje transakcijoje'),
    ('objectlockconflict', 'čiaupo moneta užrakinta kitoje, dar neužbaigtoje transakcijoje'),
    ('already locked by a different transaction', 'čiaupo moneta užrakinta kitoje, dar neužbaigtoje transakcijoje'),
)

# Bitcoin Core's reject reasons and lookup refusals, as
# Electrum relays them. A node still building its index says
# "no such transaction" too, so the indexing phrase comes
# before the plain not-found one.
BITCOIN_REFUSALS = (
    ('still in the process of being indexed', 'tinklo mazgas dar indeksuoja blokų transakcijas'),
    ('use -txindex', 'tinklo mazgas neturi transakcijų indekso, todėl ieško tik tinklo eilėje, o ne blokuose'),
    ('no such mempool or blockchain transaction', 'tinklo mazgas tokios transakcijos neturi nei blokuose, nei tinklo eilėje'),
    ('too-long-mempool-chain', 'tinkle laukia per daug nepatvirtintų čiaupo transakcijų'),
    ('missingorspent', 'čiaupo monetos, kurias bandyta išleisti, jau išleistos arba tinklas jų dar nemato'),
    ('missing-inputs', 'čiaupo monetos, kurias bandyta išleisti, jau išleistos arba tinklas jų dar nemato'),
    ('txn-mempool-conflict', 'kita laukianti čiaupo transakcija jau išleidžia tas pačias monetas'),
    ('min relay fee not met', 'transakcijos mokestis per mažas šiam tinklui'),
    ('mempool min fee not met', 'transakcijos mokestis per mažas šiam tinklui'),
    ('insufficient fee', 'transakcijos mokestis per mažas šiam tinklui'),
    ('dust', 'išmoka mažesnė už tinklo dulkių ribą'),
    ('txn-already-in-mempool', 'ši transakcija jau yra tinklo eilėje'),
    ('txn-already-known', 'ši transakcija jau yra tinklo eilėje'),
    ('already in block chain', 'ši transakcija jau įtraukta į bloką'),
    ('non-final', 'transakcija dar negali patekti į bloką'),
)

# Etherscan's refusals: it answers them with HTTP 200, status
# 0, NOTOK and the reason in its result field, and the other
# Etherscan-style APIs answer in the same shape. {name} is
# the server's own name from SERVERS, filled in when the
# reason is told. The plan refusal comes before the chain id
# one and the daily limit before the rate limits, as their
# phrases overlap.
ETHERSCAN_REFUSALS = (
    ('invalid api key', '{name} atmetė čiaupo operatoriaus API raktą'),
    ('not supported for this chain', 'čiaupo operatoriaus API rakto planas neapima šio tinklo'),
    ('daily', '{name} riboja užklausų skaičių per parą'),
    ('rate limit', '{name} riboja užklausų skaičių'),
    ('query timeout', '{name} nespėjo įvykdyti užklausos'),
    ('chainid', '{name} nepalaiko šio tinklo'),
    ('deprecated', 'čiaupo konfigūracijoje nurodytas nebepalaikomas API adresas'),
)

# Where the chain clients put a node's refusal: the prefix of
# their error text, the refusals to translate it with, and
# how an unknown one is introduced. An Electrum error is the
# node's refusal only when Bitcoin Core's wrapper says so
# (see _refusal_reason); otherwise it is the Electrum
# server's own complaint. The graph explorer raises
# Etherscan's refusals the same way, and as it may talk to
# another Etherscan-style API, those name the server they
# came from.
REFUSAL_SOURCES = (
    ('Solana RPC error: ', SOLANA_REFUSALS, 'tinklo mazgas atsakė klaida'),
    ('Sui transaction simulation failed: ', SUI_REFUSALS, 'Sui tinklas atmetė transakciją'),
    ('Sui transaction failed: ', SUI_REFUSALS, 'Sui tinklas atmetė transakciją'),
    ('Sui GraphQL error: ', SUI_REFUSALS, 'Sui GraphQL serveris atsakė klaida'),
    ('Electrum error: ', BITCOIN_REFUSALS, 'Electrum serveris atsakė klaida'),
    ('Etherscan API error: ', ETHERSCAN_REFUSALS, '{name} atsakė klaida'),
)

# Bitcoin Core's opening line around every reject reason
NETWORK_RULES = 'rejected by network rules'

# ElectrumX's own wrapper around an error the node answered
# it with — the node's error object is inside
DAEMON_ERROR = re.compile(r'^daemon error: DaemonError\((.*)\)$', re.S)

# Custom errors token contracts revert with, by signature —
# the node reports only the 4-byte selector, computed below.
# FOLD refuses every transfer with TransferRestricted until
# its token generation event; the rest are OpenZeppelin's
# standard ERC-20 and pause errors.
CONTRACT_ERRORS = {
    'TransferRestricted(address,address)': 'žetono sutartis kol kas neleidžia pervedimų',
    'ERC20InsufficientBalance(address,uint256,uint256)': 'čiaupo žetonų balansas per mažas',
    'ERC20InvalidReceiver(address)': 'žetono sutartis nepriima šio gavėjo',
    'ERC20InvalidSender(address)': 'žetono sutartis neleidžia čiaupui siųsti',
    'EnforcedPause()': 'žetono sutarties veikimas sustabdytas',
}

SELECTORS = {
    bytes(Web3.keccak(text=signature)[:4]).hex(): (signature.split('(')[0], meaning)
    for signature, meaning in CONTRACT_ERRORS.items()
}

# What the chain clients complain about themselves, by a
# phrase of their message: a configuration gap, or an answer
# they could not read
CLIENT_FAILURES = (
    ('private key not configured', 'čiaupo privatus raktas nesukonfigūruotas'),
    ('not configured', '{name} nesukonfigūruotas'),
    ('unexpected', '{name} atsakė netikėto formato duomenimis'),
    ('reply', '{name} atsakė netikėto formato duomenimis'),
)

# SQLite's own complaints, by a phrase of its message — the
# graph's cache and names live in the backend's database
# file, and when it cannot be read or written the sentence
# says why in the operator's terms. A lock outlasted the
# connection's busy timeout; the rest are a mount or a disk
# gone wrong, or a schema that was never created.
DATABASE_FAILURES = (
    ('database is locked', 'duomenų bazė užrakinta kitos rašančios užklausos'),
    ('readonly database', 'duomenų bazė atverta tik skaitymui'),
    ('disk is full', 'serverio diske nebeliko vietos'),
    ('disk i/o error', 'nepavyko perskaityti ar įrašyti duomenų bazės failo'),
    ('unable to open database file', 'nepavyko atverti duomenų bazės failo'),
    ('disk image is malformed', 'duomenų bazės failas sugadintas'),
    ('no such table', 'duomenų bazėje trūksta lentelės'),
    ('no such column', 'duomenų bazės lentelėje trūksta stulpelio'),
)








############################################################
# failure_sentence
############################################################
#
# The whole sentence the backend answers with when a call it
# depended on failed: what it could not do, a colon, the
# reason (describe_failure), and optionally what the student
# should do next. The full stop is added only when the reason
# does not end a sentence already.
#
# Used by:
#   - every faucet's claim and balance read — app/evm_faucet,
#     app/erc_faucet, app/svm_faucet, app/move_faucet,
#     app/utxo_faucet
#   - app/evm_faucet/explorer.py — the graph's Etherscan
#     refresh, its cache reads and its name saves
#   - app/utxo_faucet/explorer.py — the graph's crawl and its
#     transaction lookups
#   - main.py — the blockchain simulator's demo chain
############################################################

def failure_sentence(what, error, server, timeout_s=None, then=None):
    reason = describe_failure(error, server, timeout_s)
    sentence = f'{what}: {reason}'
    if not sentence.endswith(('.', '!', '?', '…')):
        sentence += '.'
    return f'{sentence} {then}' if then else sentence








############################################################
# describe_failure
############################################################
#
# Why one failed call went wrong, as a Lithuanian clause to
# follow the caller's own "could not ..." words. The server
# is whom the call talked to — one of SERVERS — and timeout_s
# how long that client waits, so a timeout can say for how
# long; a call without a timeout of its own (the database's)
# passes none. Transport failures are told first, then the
# database's complaints, then a node's, a contract's or
# Etherscan's refusal, then the clients' own complaints;
# anything else is the exception's type and message. The
# reason comes back scrubbed of secrets and kept short.
#
# Used by:
#   - failure_sentence (above)
############################################################

def describe_failure(error, server, timeout_s=None):
    reason = (_transport_reason(error, server, timeout_s)
              or _database_reason(error)
              or _refusal_reason(error, server)
              or _client_reason(error, server)
              or f'{type(error).__name__}: {str(error) or "be aprašymo"}')
    return _clip(redact(reason), REASON_CHARS)








############################################################
# _transport_reason
############################################################
#
# A failure on the way to the server, told by what the server
# did: answered with an HTTP error status (the access key
# refused, the request rate limited, the server's own fault),
# did not answer in time, could not be reached, dropped the
# connection, or failed the TLS handshake. A timeout names
# the client's wait when the caller gave one. Nothing for any
# other kind of failure.
#
# Used by:
#   - describe_failure (above)
############################################################

def _transport_reason(error, server, timeout_s):
    name, of, with_ = SERVERS[server]
    within = f' per {timeout_s} s' if timeout_s else ''

    response = getattr(error, 'response', None)
    if isinstance(error, requests.HTTPError) and response is not None:
        status = response.status_code
        if status in (401, 403):
            return f'{name} atmetė prieigos raktą (HTTP {status})'
        if status == 404:
            return f'{name} nerado užklausto adreso (HTTP 404)'
        if status == 429:
            return f'{name} riboja užklausų skaičių (HTTP 429)'
        if status >= 500:
            return f'{name} patyrė vidinę klaidą (HTTP {status})'
        return f'{name} grąžino klaidą (HTTP {status})'


    # The order matters: requests' TLS and connect-timeout errors
    # are connection errors too, and a connect timeout is also a
    # timeout
    if isinstance(error, (requests.exceptions.SSLError, ssl.SSLError)):
        return f'nepavyko užmegzti saugaus ryšio su {with_} (TLS)'
    if isinstance(error, requests.ConnectTimeout):
        return f'nepavyko prisijungti prie {of}{within}'
    if isinstance(error, (requests.Timeout, TimeoutError)):
        return f'{name} neatsakė{within}'
    if isinstance(error, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)) \
            or str(error) == 'Connection closed by server':
        return f'{name} nutraukė ryšį'
    if isinstance(error, (requests.ConnectionError, ConnectionError, socket.gaierror)):
        return f'nepavyko prisijungti prie {of}'
    return None








############################################################
# _database_reason
############################################################
#
# A failure of the backend's own SQLite database, told by
# SQLite's message: a known complaint (DATABASE_FAILURES)
# translated with SQLite's words in parentheses, any other
# passed on in those words. Nothing for a failure that is not
# the database's.
#
# Used by:
#   - describe_failure (above)
############################################################

def _database_reason(error):
    if not isinstance(error, sqlite3.Error):
        return None
    return _translated(str(error) or type(error).__name__, DATABASE_FAILURES, 'duomenų bazė atsakė klaida')








############################################################
# _refusal_reason
############################################################
#
# A refusal the chain itself answered with, recognized by
# where it came from: a token contract's revert (a custom
# error's selector, a panic, a revert message), an EVM node's
# JSON-RPC error, or the error text the Solana, Sui and
# Electrum clients raise with the node's answer inside — and
# Etherscan's refusal, which the graph explorer raises the
# same way and which is told in the name of the server the
# call talked to. The message is read back out of that text
# and translated when it is a known one. Nothing for any
# other failure.
#
# Used by:
#   - describe_failure (above)
############################################################

def _refusal_reason(error, server):
    if isinstance(error, ContractCustomError):
        return _custom_error_reason(error.data if isinstance(error.data, str) else error.message)
    if isinstance(error, ContractPanicError):
        return f'žetono sutarties vykdymas nutrūko ({error.message})'
    if isinstance(error, ContractLogicError):
        revert = (error.message or '').removeprefix('execution reverted').lstrip(': ').strip()
        if not revert:
            return 'žetono sutartis atmetė pervedimą, nenurodžiusi priežasties'
        return f'žetono sutartis atmetė pervedimą ({_clip(revert, QUOTE_CHARS)})'
    if isinstance(error, Web3RPCError):
        answer = (error.rpc_response or {}).get('error') or {}
        return _translated(answer.get('message') or str(error), EVM_REFUSALS, 'tinklo mazgas atsakė klaida')

    text = str(error)
    for prefix, refusals, unknown in REFUSAL_SOURCES:
        if text.startswith(prefix):
            message = _node_message(text[len(prefix):])
            if NETWORK_RULES in message:
                message, unknown = _reason_line(message), 'tinklo mazgas atmetė transakciją'
            return _translated(message, refusals, unknown, SERVERS[server][0])
    return None








############################################################
# _custom_error_reason
############################################################
#
# A token contract's custom error, told by its selector — the
# first four bytes of the revert data. A known one is named
# and explained; an unknown one is given by its selector, the
# handle to look it up in the contract's ABI.
#
# Used by:
#   - _refusal_reason (above)
############################################################

def _custom_error_reason(data):
    selector = (data or '').removeprefix('0x')[:8].lower()
    if selector in SELECTORS:
        name, meaning = SELECTORS[selector]
        return f'{meaning} ({name})'
    return f'žetono sutartis atmetė pervedimą (klaida 0x{selector})'








############################################################
# _node_message
############################################################
#
# The message field of a node's error, read back out of the
# text a client raised: the clients print the node's error
# object as Python shows it — a dict, or GraphQL's list of
# them. ElectrumX wraps a node's error once more in its own
# ("daemon error: DaemonError(...)"), so a message in that
# wrapper is read again for the node's own words. Text of any
# other form is the message itself.
#
# Used by:
#   - _refusal_reason (above)
############################################################

def _node_message(text):
    try:
        value = ast.literal_eval(text.strip())
    except (ValueError, SyntaxError):
        return text.strip()
    if isinstance(value, list) and value:
        value = value[0]
    if isinstance(value, dict) and isinstance(value.get('message'), str):
        wrapped = DAEMON_ERROR.match(value['message'].strip())
        return _node_message(wrapped.group(1)) if wrapped else value['message']
    return text.strip()








############################################################
# _reason_line
############################################################
#
# Bitcoin Core wraps its reject reason in a fixed opening —
# "the transaction was rejected by network rules", a blank
# line, the reason, then the raw transaction in brackets.
# The reason is the line after that opening; any other
# message is kept whole.
#
# Used by:
#   - _refusal_reason (above)
############################################################

def _reason_line(message):
    lines = [line.strip() for line in message.splitlines() if line.strip()]
    if len(lines) > 1 and NETWORK_RULES in lines[0]:
        return lines[1]
    return message.strip()








############################################################
# _translated
############################################################
#
# A node's, Etherscan's or the database's message as a
# reason: the Lithuanian meaning of the first known phrase it
# contains, with the message's own words in parentheses — or,
# when no phrase is known, those words after the given
# introduction. A {name} in the meaning or the introduction
# becomes the name of the server that answered.
#
# Used by:
#   - _database_reason, _refusal_reason (above)
############################################################

def _translated(message, refusals, unknown, name=''):
    quoted = _clip(message, QUOTE_CHARS)
    lowered = message.lower()
    for phrase, meaning in refusals:
        if phrase in lowered:
            return f"{meaning.replace('{name}', name)} ({quoted})"
    return f"{unknown.replace('{name}', name)}: {quoted}"








############################################################
# _client_reason
############################################################
#
# The chain clients' own complaints — a ValueError naming a
# configuration gap or an answer they could not read — told
# in the server's terms. Nothing for any other failure.
#
# Used by:
#   - describe_failure (above)
############################################################

def _client_reason(error, server):
    if not isinstance(error, ValueError):
        return None

    lowered = str(error).lower()
    for phrase, meaning in CLIENT_FAILURES:
        if phrase in lowered:
            return meaning.format(name=SERVERS[server][0])
    return None








############################################################
# _clip
############################################################
#
# Text cut to a length, an ellipsis marking the cut.
#
# Used by:
#   - describe_failure, _refusal_reason, _translated (above)
############################################################

def _clip(text, limit):
    text = text.strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + '…'
