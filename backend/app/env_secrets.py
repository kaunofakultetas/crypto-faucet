############################################################
#  [*] Environment secrets — placeholders in, nothing out
#
#  Two halves of one contract. <NAME> placeholders in config
#  URLs (an Infura project id, a test secret) resolve from the
#  environment, so the config file never holds a key — and a
#  placeholder the environment does NOT provide is an operator
#  error that must fail the boot, not resolve to '' and 500
#  every claim. And whatever a placeholder resolved to must
#  never reach the container log: requests puts the FULL URL
#  into its exception text, and every logging.exception in the
#  faucets prints that traceback. So every substituted value
#  (and any secret registered by hand, like the Etherscan key)
#  is remembered, and a filter on the root logger replaces it
#  with <redacted> in messages and tracebacks alike.
#
#  The filter sits on the ROOT logger: the app logs through
#  the module-level logging.* calls, which all go to root, and
#  a logger filter runs before any handler — including the
#  one unittest's assertLogs installs.
#
#  Used by:
#    - app/evm_faucet/evm_faucet.py, app/svm_faucet/svm_faucet.py,
#      app/move_faucet/move_faucet.py — rpc_url templates
#    - app/evm_faucet/explorer.py — the Etherscan API key
############################################################


import os
import re
import logging


PLACEHOLDER = re.compile(r'<(\w+)>')

# Every value ever substituted or registered — process-wide,
# the log is process-wide too
_secrets = set()








############################################################
# resolve_placeholders
############################################################
#
# The template with every <NAME> replaced by that environment
# variable's value. An unset or empty variable raises a
# ValueError naming the placeholder and the config entry
# (`label`), so the boot dies with the operator's mistake in
# the console. Every substituted value is remembered for the
# log filter below.
#
# Used by:
#   - the three faucet __init__s — one call per network
############################################################

def resolve_placeholders(template, label='config'):

    def substitute(match):
        name = match.group(1)
        value = os.getenv(name, '')
        if not value:
            raise ValueError(f"{label}: placeholder <{name}> is not set in the environment")
        remember_secret(value)
        return value

    return PLACEHOLDER.sub(substitute, template or '')








############################################################
# remember_secret
############################################################
#
# Register a value the log must never show. Empty values are
# ignored — replacing '' would corrupt every message.
#
# Used by:
#   - resolve_placeholders (above)
#   - app/evm_faucet/explorer.py — the Etherscan API key
############################################################

def remember_secret(value):
    if value:
        _secrets.add(str(value))








############################################################
# RedactSecretsFilter
############################################################
#
# The root-logger filter: rewrites the record's message and —
# when it carries an exception — formats the traceback itself,
# scrubs it, and stores it as exc_text with exc_info cleared,
# so every handler downstream prints the scrubbed text instead
# of re-formatting the raw exception. A record is never
# dropped; only its text changes.
#
# Used by:
#   - install_log_redaction (below)
############################################################

class RedactSecretsFilter(logging.Filter):







    ############################################################
    # filter
    ############################################################
    #
    # Used by:
    #   - the logging machinery, on every root-logger record
    ############################################################

    def filter(self, record):
        if not _secrets:
            return True

        record.msg = _scrub(record.getMessage())
        record.args = ()

        if record.exc_info:
            record.exc_text = _scrub(logging.Formatter().formatException(record.exc_info))
            record.exc_info = None

        return True








############################################################
# _scrub
############################################################
#
# Used by:
#   - RedactSecretsFilter.filter (above)
############################################################

def _scrub(text):
    for secret in _secrets:
        text = text.replace(secret, '<redacted>')
    return text








############################################################
# install_log_redaction
############################################################
#
# Attach the filter to the root logger once — safe to call
# from every faucet constructor.
#
# Used by:
#   - the three faucet __init__s and the explorer's
############################################################

def install_log_redaction():
    root = logging.getLogger()
    if not any(isinstance(existing, RedactSecretsFilter) for existing in root.filters):
        root.addFilter(RedactSecretsFilter())
