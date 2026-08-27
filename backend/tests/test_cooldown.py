############################################################
#  [*] Cooldown table regression tests
#
#  Offline checks of the shared claim/release semantics all
#  three faucets rely on: the first claim wins, a second one
#  inside the window is refused with the remaining seconds, a
#  release (the failure path) reopens the slot immediately,
#  expiry reopens it by itself, keys don't interfere, a host
#  clock that steps BACKWARDS can never inflate the wait, and
#  expired entries are swept so the table never grows for
#  the life of the process.
#  Time is mocked — no sleeping in tests.
############################################################


import unittest
from unittest.mock import patch

from app.cooldown import CooldownTable




############################################################
# CooldownTableTests
############################################################

class CooldownTableTests(unittest.TestCase):

    def test_first_claim_wins_second_is_refused(self):
        table = CooldownTable(seconds=60)
        with patch('app.cooldown.time.time', return_value=1000):
            self.assertEqual(table.claim(('net', 'addr')), 0)
            self.assertEqual(table.claim(('net', 'addr')), 60)

    def test_refusal_reports_remaining_seconds(self):
        table = CooldownTable(seconds=60)
        with patch('app.cooldown.time.time', return_value=1000):
            table.claim(('net', 'addr'))
        with patch('app.cooldown.time.time', return_value=1040):
            self.assertEqual(table.claim(('net', 'addr')), 20)

    def test_release_reopens_the_slot(self):
        # The failure path: a failed payout must not count as a claim
        table = CooldownTable(seconds=60)
        with patch('app.cooldown.time.time', return_value=1000):
            table.claim(('net', 'addr'))
            table.release(('net', 'addr'))
            self.assertEqual(table.claim(('net', 'addr')), 0)

    def test_expiry_reopens_the_slot(self):
        table = CooldownTable(seconds=60)
        with patch('app.cooldown.time.time', return_value=1000):
            table.claim(('net', 'addr'))
        with patch('app.cooldown.time.time', return_value=1060):
            self.assertEqual(table.claim(('net', 'addr')), 0)

    def test_keys_do_not_interfere(self):
        # Claiming on one chain must not lock the wallet out of others
        table = CooldownTable(seconds=60)
        with patch('app.cooldown.time.time', return_value=1000):
            self.assertEqual(table.claim(('sepolia', 'addr')), 0)
            self.assertEqual(table.claim(('holesky', 'addr')), 0)
            self.assertEqual(table.claim(('sepolia', 'other')), 0)

    def test_release_of_unclaimed_key_is_harmless(self):
        table = CooldownTable(seconds=60)
        table.release(('net', 'never-claimed'))

    def test_a_backwards_clock_step_never_inflates_the_wait(self):
        # NTP or a VM resume steps the host clock back five minutes:
        # a claim recorded "in the future" counts as expired, it
        # must never become a five-minute wait
        table = CooldownTable(seconds=60)
        with patch('app.cooldown.time.time', return_value=1000):
            table.claim(('net', 'addr'))
        with patch('app.cooldown.time.time', return_value=700):
            self.assertEqual(table.claim(('net', 'addr')), 0)

    def test_expired_entries_are_evicted_eventually(self):
        # Every fresh wallet is a new key and nothing else removes
        # one — expired entries are swept once per window
        table = CooldownTable(seconds=60)
        with patch('app.cooldown.time.time', return_value=1000):
            for i in range(5000):
                table.claim(('net', f'addr{i}'))

        with patch('app.cooldown.time.time', return_value=2000):
            table.claim(('net', 'late'))

        self.assertEqual(len(table._last_claim), 1)

    def test_the_sweep_keeps_live_entries(self):
        table = CooldownTable(seconds=60)
        with patch('app.cooldown.time.time', return_value=1000):
            table.claim(('net', 'old'))
        with patch('app.cooldown.time.time', return_value=1050):
            table.claim(('net', 'fresh'))
        with patch('app.cooldown.time.time', return_value=1070):
            table.claim(('net', 'trigger'))                    # sweeps: 'old' expired, 'fresh' not
            self.assertEqual(table.claim(('net', 'fresh')), 40)
            self.assertEqual(table.claim(('net', 'old')), 0)


if __name__ == '__main__':
    unittest.main()
