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
#  Reachability: breadth-first from the class' NAMED wallets
#  (the operator's labels — the faucet address itself is a
#  root only if it is named too; the graph page, by contrast,
#  always roots at the faucet), PER NETWORK — the graph is
#  strictly per network, so a wallet's traffic on one chain
#  never keeps its traffic on another — and never expanding
#  through is_contract/is_hub addresses (they stay as leaves).
#  What the walk reaches is kept; everything else is stranger
#  traffic. With NO named wallet the walk reaches nothing and
#  --apply would drop every row, so the tool refuses to run:
#  name the faucet first. Rows are deleted by rowid (the
#  cached schema's id column is not a rowid alias) and the
#  orphan cleanup keeps every flagged contract/hub row — the
#  explorer's classification depends on them.
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
from collections import defaultdict, deque

# Run as `python tools/prune_unreachable_transactions.py` from
# /app — the app package sits one level up
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from app.database.db import get_db_connection


# The same default as app/database/db.py — the live database,
# not a fresh empty file next to the tool
DB_PATH = os.getenv('DB_PATH', '/data/database.db')








############################################################
# main
############################################################
#
# The CLI entry: opens the database through the app's own
# helper, runs prune() in dry-run or --apply mode, and closes
# the connection whichever way prune() ends.
#
# Used by:
#   - the __main__ guard at the bottom
#   - tests, with DB_PATH and sys.argv patched
############################################################

def main():
    conn = get_db_connection(DB_PATH)
    try:
        prune(conn, apply_changes='--apply' in sys.argv)
    finally:
        conn.close()








############################################################
# prune
############################################################
#
# The walk and the deletes, on an open connection: load the
# graph, flood from the named roots per network, report the
# stranger rows and — with apply_changes — delete them plus
# the orphaned unnamed, unflagged addresses. Commits and
# VACUUMs on its own; the caller closes. Exits (SystemExit)
# rather than run against an empty root set.
#
# Used by:
#   - main (above)
############################################################

def prune(conn, apply_changes):

    # STEP 1: load the graph — every cached transaction as an
    # undirected edge on ITS network, plus the two address sets
    # that steer the walk: the named wallets (the class' anchors)
    # as roots and the flagged contracts/hubs as walls the walk
    # never passes through.
    # ============================================================
    blocked = {row[0] for row in conn.execute(
        "SELECT address FROM Graph_Addresses WHERE COALESCE(is_contract, 0) = 1 OR COALESCE(is_hub, 0) = 1")}
    roots = {row[0] for row in conn.execute(
        "SELECT address FROM Graph_Addresses WHERE name IS NOT NULL AND name != ''")}

    if not roots:
        sys.exit("Refusing to run: no named wallet to walk from — every row would be dropped. "
                 "Name the faucet address in the graph first.")

    rows = conn.execute(
        "SELECT rowid AS rid, network, from_address, to_address FROM Graph_Transactions").fetchall()
    networks = {row['network'] for row in rows}
    adjacency = defaultdict(set)
    for row in rows:
        adjacency[(row['network'], row['from_address'])].add(row['to_address'])
        adjacency[(row['network'], row['to_address'])].add(row['from_address'])


    # STEP 2: breadth-first walk from the named wallets, on every
    # network separately. A contract or hub can be REACHED (it
    # stays a leaf on the graph) but is never expanded — its far
    # side stays dark, exactly like the frontend's sweep.
    # ============================================================
    visited = set()
    queue = deque((network, root) for network in networks for root in roots)
    while queue:
        node = queue.popleft()
        if node in visited:
            continue
        visited.add(node)
        if node[1] in blocked:
            continue
        for neighbor in adjacency[node]:
            if (node[0], neighbor) not in visited:
                queue.append((node[0], neighbor))

    good = {node for node in visited if node[1] not in blocked}


    # STEP 3: partition the rows. A row survives when at least
    # one endpoint is a reachable class wallet ON THAT NETWORK —
    # a stranger's donation to a public hub has neither.
    # ============================================================
    drop = [row for row in rows
            if (row['network'], row['from_address']) not in good
            and (row['network'], row['to_address']) not in good]

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


    # STEP 4: delete the stranger rows (by rowid — the cached
    # schema's id column is not a rowid alias and can be NULL),
    # then the unnamed, unflagged addresses that no remaining
    # transaction mentions. Named ones are kept unconditionally
    # (a label is the operator's deliberate act) and so are the
    # flagged contracts/hubs (the explorer's classification —
    # losing them would let the next sweep scrape a hub again).
    # VACUUM reclaims the space.
    # ============================================================
    conn.executemany("DELETE FROM Graph_Transactions WHERE rowid = ?",
                     [(row['rid'],) for row in drop])

    remaining = {row[0] for row in conn.execute("SELECT from_address FROM Graph_Transactions")} | \
                {row[0] for row in conn.execute("SELECT to_address FROM Graph_Transactions")}
    orphans = [row[0] for row in conn.execute("""
                   SELECT address FROM Graph_Addresses
                   WHERE (name IS NULL OR name = '')
                     AND COALESCE(is_contract, 0) = 0 AND COALESCE(is_hub, 0) = 0
               """)
               if row[0] not in remaining]
    conn.executemany("DELETE FROM Graph_Addresses WHERE address = ?",
                     [(address,) for address in orphans])

    conn.commit()
    conn.execute("VACUUM")
    print(f"\nDeleted {len(drop)} transactions and {len(orphans)} orphaned unnamed addresses.")




if __name__ == '__main__':
    main()
