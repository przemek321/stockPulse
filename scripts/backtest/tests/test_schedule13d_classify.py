"""Testy klasyfikatora Item 4 (teczka 13D, krok 3)."""
from schedule13d_classify import BOILERPLATE, classify

PASSIVE = ("The Reporting Persons acquired the shares for investment purposes. The Reporting Persons may engage in "
           "discussions with management and the board regarding strategic alternatives, may nominate directors, "
           "and may seek to take any of the actions described in (a) through (j) of Item 4 from time to time.")


def test_boilerplate_alone_is_not_activist():
    assert classify("", "", PASSIVE, "", "")[0] == "B"
    for phrase in BOILERPLATE:
        assert classify("", "", f"The Reporting Persons {phrase} the Issuer.", "", "")[0] == "B"


def test_letter_delivered_is_activist():
    t = PASSIVE + " On March 3, 2025, the Reporting Persons delivered a letter to the Board urging a sale."
    assert classify("", "", t, "", "")[0] == "A"


def test_negated_letter_is_not_activist():
    t = "The Reporting Persons have not delivered a letter to the Issuer and have no plans."
    assert classify("", "", t, "", "")[0] == "B"


def test_nomination_notice_and_cooperation_agreement():
    assert classify("", "", "Ancora delivered a notice of nomination to the Issuer.", "", "")[0] == "A"
    assert classify("", "", "", "On May 1 the Issuer entered into a Cooperation Agreement with Elliott to appoint two directors.", "")[0] == "A"


def test_exhibit_letter_counts_as_activist():
    assert classify("", "", PASSIVE, "", "99.1 Letter to the Board of Directors, dated June 2, 2025")[0] == "A"


def test_merger_counterparty_is_c_even_with_letter():
    t = ("The Reporting Persons entered into the Agreement and Plan of Merger with the Issuer. "
         "Parent delivered a letter to the Issuer.")
    assert classify("", "", t, "", "")[0] == "C"


def test_activist_opposing_announced_deal_is_a():
    t = ("The Issuer entered into an Agreement and Plan of Merger with Buyer. On May 2 the Reporting Persons sent a "
         "letter to the Issuer informing it that they do not support the proposed going private transaction.")
    assert classify("", "", t, "", "")[0] == "A"


def test_board_designation_rights_are_not_activist():
    t = ("Pursuant to the Investment Agreement, the Reporting Person has the right to designate individuals to be "
         "elected or nominated for election as a director, included among the slate recommended by the board.")
    assert classify("", "", t, "", "")[0] == "B"
    assert classify("", "", "The Issuer filed a preliminary proxy statement for the annual meeting.", "", "")[0] == "B"


def test_nomination_letter_is_activist():
    t = "Carronade delivered a letter to the Issuer (the nomination letter) nominating a slate of director candidates."
    assert classify("", "", t, "", "")[0] == "A"


def test_insider_role_is_c():
    assert classify("Mr. Smith is the Chief Executive Officer of the Issuer.", "", PASSIVE, "", "")[0] == "C"


def test_rsu_vesting_is_c():
    assert classify("", "", "The shares were acquired upon vesting of restricted stock units.", "", "")[0] == "C"


def test_pipe_is_b():
    t = "The Reporting Persons purchased the shares pursuant to a Securities Purchase Agreement in a private placement."
    assert classify("", t, PASSIVE, "", "")[0] == "B"


def test_anonymize_and_weighted_recall():
    from schedule13d_validate import anonymize, weighted_metrics
    t = anonymize("Starboard Value LP delivered a letter to Acme Widgets Inc. (ACME) on March 3, 2025 for $12.5 million.",
                  ["Starboard Value LP", "Acme Widgets Inc."], ["ACME"], "")
    assert "Starboard" not in t and "Acme" not in t and "ACME" not in t and "2025" not in t and "12.5" not in t
    assert "delivered a letter" in t
    rows = ([{"stratum": "A", "label": "A"}] * 36 + [{"stratum": "A", "label": "nonA"}] * 4
            + [{"stratum": "rest", "label": "A"}] * 3 + [{"stratum": "rest", "label": "nonA"}] * 37)
    prec, rec = weighted_metrics(rows, {"A": 150, "rest": 1500})
    assert abs(prec - 0.9) < 1e-9
    # TP ≈ 0.9·150 = 135; FN ≈ 3/40·1500 = 112.5 → czułość ≈ 0.545 (nieważona byłaby 36/39 ≈ 0.92)
    assert abs(rec - 135 / (135 + 112.5)) < 1e-9


def test_correction1_false_positives():
    # lista rekomendowana przez radę z praw umownych, proxy contest jako możliwość, letters testamentary, umowa handlowa
    assert classify("", "", "The designee will be included in the slate of nominees recommended by the Board.", "", "")[0] == "B"
    assert classify("", "", "The Reporting Persons may take actions including a proxy contest.", "", "")[0] == "B"
    assert classify("", "", "The trust was formed and the court issued letters testamentary to the executor.", "", "")[0] == "B"
    assert classify("", "", "The parties entered into a commercial cooperation agreement for distribution.", "", "")[0] == "B"


def test_correction1_false_negatives():
    assert classify("", "", "The Reporting Persons filed a preliminary consent statement to expand the Board.", "", "")[0] == "A"
    assert classify("", "", "The Reporting Persons submitted to the Issuer a notice of requisition to nominate a slate.", "", "")[0] == "A"
    assert classify("", "", "The Reporting Person intends to vote against the proposed asset sale.", "", "")[0] == "A"
    t = ("The Issuer agreed to a merger between Merger Sub and the Issuer. TSC issued an open letter to shareholders "
         "expressing its intent to vote against the merger.")
    assert classify("", "", t, "", "")[0] == "A"
    t = ("The Reporting Person entered into a securities purchase agreement to buy shares. The Reporting Person "
         "delivered a letter to the Issuer nominating a slate of director candidates.")
    assert classify("", "", t, "", "")[0] == "A"
    assert classify("", "", "The Issuer entered into a Cooperation Agreement with the Reporting Persons, including "
                    "standstill provisions and the appointment of a director.", "", "")[0] == "A"
