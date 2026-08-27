############################################################
#  [*] Cooldown table — pinned defects (expected failures)
#
#  Regression tests written BEFORE the fix. Each test states
#  the behaviour the table SHOULD have and is marked
#  @unittest.expectedFailure because today it does not. The
#  moment a fix lands, unittest reports the test as an
#  "unexpected success" — which FAILS the run — and that is
#  the cue: drop the decorator and move the test into
#  test_cooldown.py. Time is mocked — no sleeping.
############################################################


import unittest
from unittest.mock import patch

from app.cooldown import CooldownTable




############################################################
# EvictionTests
############################################################
#
# claim() inserts and nothing ever sweeps: an expired entry
# can never refuse a claim again, yet it stays in the dict
# for the life of the process — one permanent entry per
# address ever seen, and every fresh wallet is a new key.
# Expired entries must go, amortised, under the lock the
# table already holds.
############################################################

class EvictionTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_expired_entries_are_evicted_eventually(self):
        table = CooldownTable(seconds=60)
        with patch('app.cooldown.time.time', return_value=1000):
            for i in range(5000):
                table.claim(('net', f'addr{i}'))

        with patch('app.cooldown.time.time', return_value=2000):
            table.claim(('net', 'late'))

        self.assertLess(len(table._last_claim), 5000)


if __name__ == '__main__':
    unittest.main()
