"""Testy Fazy 0 teczki 13D (wejście, epizody, splity, MDE)."""
import datetime as dt

from schedule13d_phase0 import build_episodes, entry_and_last_close, mde, split_factor

# pt 07.03, pn 10.03, wt 11.03, śr 12.03 2025
S = [dt.date(2025, 3, 7), dt.date(2025, 3, 10), dt.date(2025, 3, 11), dt.date(2025, 3, 12)]


def at(d, h, m=0):
    return dt.datetime.combine(d, dt.time(h, m))


def test_entry_before_9_same_day():
    assert entry_and_last_close(S, at(S[1], 8, 59)) == (1, 0)


def test_entry_in_session_next_day_last_close_previous():
    assert entry_and_last_close(S, at(S[1], 9, 0)) == (2, 0)
    assert entry_and_last_close(S, at(S[1], 15, 59)) == (2, 0)


def test_after_close_and_after_22():
    assert entry_and_last_close(S, at(S[1], 17, 30)) == (2, 1)
    assert entry_and_last_close(S, at(S[1], 22, 30)) == (2, 1)


def test_weekend():
    assert entry_and_last_close(S, at(dt.date(2025, 3, 8), 12)) == (1, 0)


def test_last_session_has_no_entry():
    assert entry_and_last_close(S, at(S[3], 18)) == (None, 3)


def _f(acc, issuer, idx):
    return {"accession": acc, "issuer": issuer, "entry_idx": idx}


def test_episodes_merge_within_5_and_flag_later():
    eps = build_episodes([_f("a", "X", 10), _f("b", "X", 14), _f("c", "X", 19), _f("d", "X", 30)])
    assert len(eps) == 1
    assert eps[0]["members"] == ["a", "b", "c"] and eps[0]["later_13d"] is True


def test_episode_new_after_horizon_and_per_issuer():
    eps = build_episodes([_f("a", "X", 10), _f("b", "X", 74), _f("c", "Y", 12)])
    assert sorted((e["issuer"], e["members"][0]) for e in eps) == [("X", "a"), ("X", "b"), ("Y", "c")]
    eps = build_episodes([_f("a", "X", 10), _f("b", "X", 73)])
    assert len(eps) == 1 and eps[0]["later_13d"]


def test_split_factor_window():
    sp = [(dt.date(2025, 3, 10), 0.1), (dt.date(2025, 4, 1), 2.0)]
    assert split_factor(sp, dt.date(2025, 3, 7), dt.date(2025, 3, 10)) == 0.1
    assert split_factor(sp, dt.date(2025, 3, 10), dt.date(2025, 3, 31)) == 1.0
    assert split_factor(sp, dt.date(2025, 1, 1), dt.date(2025, 12, 31)) == 0.2


def test_mde():
    assert abs(mde(0.35, 30) - 2.8016 * 0.35 / 30 ** 0.5) < 1e-3
