from scripts.soak import pg_observer as ob


def test_parse_csv_handles_quoted_query_text():
    # psql --csv quotes fields with commas/newlines; the query column often has both.
    raw = '"SELECT a,\n b",10,1.5\n"UPDATE t SET x = 1, y = 2",4,2.0\n'
    rows = ob.parse_psql_csv(raw, ["query", "calls", "mean_ms"])
    assert rows[0]["query"] == "SELECT a,\n b"
    assert rows[1]["query"] == "UPDATE t SET x = 1, y = 2"
    assert rows[1]["calls"] == "4"


def test_activity_metrics():
    rows = [
        {"state": "active", "wait_event_type": "", "query_age": "2.0", "state_age": "2.0"},
        {"state": "active", "wait_event_type": "Lock", "query_age": "9.0", "state_age": "9.0"},
        {"state": "idle", "wait_event_type": "", "query_age": "", "state_age": "30.0"},
        {"state": "idle in transaction", "wait_event_type": "", "query_age": "", "state_age": "45.0"},  # noqa: E501
    ]
    m = ob.activity_metrics(rows)
    assert m["total"] == 4
    assert m["active"] == 2
    assert m["idle"] == 1
    assert m["idle_in_transaction"] == 1
    assert m["waiting"] == 1
    assert m["longest_query_age_s"] == 9.0
    assert m["longest_idle_in_txn_s"] == 45.0


def test_database_metrics_cache_hit_ratio():
    row = {"numbackends": "5", "xact_commit": "100", "xact_rollback": "2",
           "blks_read": "10", "blks_hit": "990", "deadlocks": "0",
           "temp_files": "0", "temp_bytes": "0"}
    m = ob.database_metrics(row)
    assert m["cache_hit_ratio"] == 0.99
    assert m["deadlocks"] == 0


def test_database_metrics_zero_blocks_is_safe():
    row = {"numbackends": "1", "xact_commit": "0", "xact_rollback": "0",
           "blks_read": "0", "blks_hit": "0", "deadlocks": "0",
           "temp_files": "0", "temp_bytes": "0"}
    assert ob.database_metrics(row)["cache_hit_ratio"] is None


def test_lock_metrics():
    rows = [
        {"mode": "AccessShareLock", "granted": "t"},
        {"mode": "AccessShareLock", "granted": "t"},
        {"mode": "ExclusiveLock", "granted": "f"},
    ]
    m = ob.lock_metrics(rows)
    assert m["total"] == 3
    assert m["not_granted"] == 1
    assert m["by_mode"]["AccessShareLock"] == 2


def test_statements_diff_flags_growth():
    start = [{"queryid": "1", "calls": "10", "mean_exec_time": "5.0", "max_exec_time": "8.0"}]
    end = [{"queryid": "1", "calls": "110", "mean_exec_time": "20.0", "max_exec_time": "40.0",
            "query": "SELECT ..."}]
    diff = ob.statements_diff(start, end)
    assert diff[0]["mean_ms_start"] == 5.0
    assert diff[0]["mean_ms_end"] == 20.0
    assert diff[0]["mean_ratio"] == 4.0
