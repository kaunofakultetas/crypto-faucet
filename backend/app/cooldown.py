############################################################
#  [*] Cooldown table
#
#  The one shared implementation of "this wallet already
#  claimed recently" for every faucet type. The crucial detail
#  is that checking and claiming are ONE atomic step: a bare
#  check-then-set lets two parallel requests from the same
#  address both pass the check, serialize politely on the send
#  lock and get paid twice. Here the first request claims the
#  slot under the lock and every later one is refused until
#  the claim expires — a failed payout releases the slot so a
#  student is never locked out by an error. EVERY failure
#  releases, including a broadcast that timed out and may
#  have reached the node anyway, so the retry can pay a
#  second chunk. Accepted: a rare double payout of testnet
#  coin beats a student stuck behind an error. release()
#  likewise gives back whatever claim the key holds: a
#  payout that outlives the window and then fails releases
#  the NEWER claim recorded meanwhile — a claim token would
#  fix it; the same rare extra chunk is accepted.
#
#  Deliberately in-memory: the table resets on restart and a
#  freshly generated wallet walks around it — both accepted
#  for a lab faucet paying out testnet coins. (This also makes
#  the whole backend single-process by design: run gunicorn
#  with one worker.)
#
#  Used by:
#    - evm_faucet/evm_faucet.py — per (network, address)
#    - erc_faucet/erc20_faucet.py — per (network, token, address)
#    - utxo_faucet/utxo_faucet.py — per (network, address)
#    - svm_faucet/svm_faucet.py — per (network, address)
############################################################


import time
import threading








############################################################
# CooldownTable
############################################################
#
# One instance per faucet, each with its own window length and
# key shape — the keys are opaque tuples to this class.
#
# Used by:
#   - the four faucet __init__s — one instance each
############################################################

class CooldownTable:






    ############################################################
    # __init__
    ############################################################
    #
    # seconds is the cooldown window; the lock guards the
    # claim map so check-and-claim stays one atomic step.
    #
    # Used by:
    #   - the four faucet __init__s
    ############################################################

    def __init__(self, seconds):
        self.seconds = int(seconds)
        self._lock = threading.Lock()
        self._last_claim = {}






    ############################################################
    # claim
    ############################################################
    #
    # Atomically claim the key's slot. Returns 0 when the claim
    # succeeded (the caller may proceed with the payout) or the
    # number of seconds still remaining when the key is cooling
    # down. No RPC or I/O ever happens under the lock.
    #
    # Used by:
    #   - the faucets' payout paths, right before the slow work
    ############################################################

    def claim(self, key):
        now = int(time.time())
        with self._lock:
            last = self._last_claim.get(key)
            if last is not None and now - last < self.seconds:
                return self.seconds - (now - last)
            self._last_claim[key] = now
            return 0






    ############################################################
    # release
    ############################################################
    #
    # Give a claimed slot back — called on every failure path
    # after a successful claim, so a failed payout attempt never
    # counts as the student's claim. Releasing an unclaimed key
    # is harmless.
    #
    # Used by:
    #   - the faucets' payout failure paths
    ############################################################

    def release(self, key):
        with self._lock:
            self._last_claim.pop(key, None)
