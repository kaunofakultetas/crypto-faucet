############################################################
#  [*] Prune unreachable transactions
#
#  One-shot admin tool that removes CONTAMINATION from the
#  explorer cache: transactions whose endpoints are not
#  reachable from any named (labeled) wallet without passing
#  THROUGH a contract or a public hub. Such rows exist when a
#  token contract or a community faucet was ever swept as if
#  it were a class wallet — its global history dragged
#  thousands of unrelated testnet strangers into the cache.
#
#  Reachability mirrors exactly how the graph explores:
#  breadth-first from the class' named wallets, never
#  expanding through is_contract/is_hub addresses (they stay
#  as leaves). Everything the graph could legitimately reach
#  is kept; everything else is stranger traffic.
#
#  Dry run by default — prints what WOULD be deleted. Pass
#  --apply to actually delete (make a copy of the database
#  first). Deleted history is only a cache: anything a future
#  sweep legitimately reaches is re-fetched from Etherscan.
#
#  Run inside the backend container:
#    sudo docker exec faucet-backend python tools/prune_unreachable_transactions.py
#    sudo docker exec faucet-backend python tools/prune_unreachable_transactions.py --apply
#
#  Used by:
#    - the operator, manually — not imported by the app
############################################################


import os
import sys
import sqlite3
from collections import defaultdict, deque


DB_PATH = os.getenv('DB_PATH', 'transactions.db')




def main():
    apply_changes = '--apply' in sys.argv

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row


    # STEP 1: load the graph — every cached transaction as an
    # undirected edge, plus the two address sets that steer the
    # walk: the named wallets (the class' anchors) as roots and
    # the flagged contracts/hubs as walls the walk never passes
    # through.
    # ============================================================
    blocked = {row[0] for row in conn.execute(
        "SELECT address FROM addresses WHERE COALESCE(is_contract, 0) = 1 OR COALESCE(is_hub, 0) = 1")}
    roots = {row[0] for row in conn.execute(
        "SELECT address FROM addresses WHERE name IS NOT NULL AND name != ''")}

    rows = conn.execute(
        "SELECT id, network, from_address, to_address FROM transactions").fetchall()
    adjacency = defaultdict(set)
    for row in rows:
        adjacency[row['from_address']].add(row['to_address'])
        adjacency[row['to_address']].add(row['from_address'])


    # STEP 2: breadth-first walk from the named wallets. A
    # contract or hub can be REACHED (it stays a leaf on the
    # graph) but is never expanded — its far side stays dark,
    # exactly like the frontend's sweep.
    # ============================================================
    visited = set()
    queue = deque(roots)
    while queue:
        node = queue.popleft()
        if node in visited:
            continue
        visited.add(node)
        if node in blocked:
            continue
        for neighbor in adjacency[node]:
            if neighbor not in visited:
                queue.append(neighbor)

    good = visited - blocked


    # STEP 3: partition the rows. A row survives when at least
    # one endpoint is a reachable class wallet — a stranger's
    # donation to a public hub has neither.
    # ============================================================
    drop = [row for row in rows
            if row['from_address'] not in good and row['to_address'] not in good]

    per_network = defaultdict(lambda: [0, 0])
    for row in rows:
        per_network[row['network']][0] += 1
    for row in drop:
        per_network[row['network']][0] -= 1
        per_network[row['network']][1] += 1

    print("network            kept  drop")
    for network, (kept, dropped) in sorted(per_network.items()):
        print(f"{network:<18} {kept:>5} {dropped:>5}")
    print(f"TOTAL              {len(rows) - len(drop):>5} {len(drop):>5}"
          f"   (reachable class wallets: {len(good)})")

    if not apply_changes:
        print("\nDry run — nothing deleted. Re-run with --apply to delete.")
        return


    # STEP 4: delete the stranger rows, then the unnamed
    # addresses that no remaining transaction mentions (named
    # ones are kept unconditionally — a label is the operator's
    # deliberate act). VACUUM reclaims the space.
    # ============================================================
    conn.executemany("DELETE FROM transactions WHERE id = ?",
                     [(row['id'],) for row in drop])

    remaining = {row[0] for row in conn.execute("SELECT from_address FROM transactions")} | \
                {row[0] for row in conn.execute("SELECT to_address FROM transactions")}
    orphans = [row[0] for row in conn.execute(
                   "SELECT address FROM addresses WHERE name IS NULL OR name = ''")
               if row[0] not in remaining]
    conn.executemany("DELETE FROM addresses WHERE address = ?",
                     [(address,) for address in orphans])

    conn.commit()
    conn.execute("VACUUM")
    print(f"\nDeleted {len(drop)} transactions and {len(orphans)} orphaned unnamed addresses.")




if __name__ == '__main__':
    main()
