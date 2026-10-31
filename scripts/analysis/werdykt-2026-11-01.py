#!/usr/bin/env python3
"""Werdykt #2 (01.11.2026) — przeliczenie wg pre-rejestracji z KALENDARZ-WALIDACJI (01.09 + 23.09).
Wejście: alerts.csv, insider_trades.csv, tickers.csv (eksport z prod). Python 3.8 stdlib."""
import csv, re, random, statistics as st, datetime as dt, sys
from collections import defaultdict

D = (sys.argv[1].rstrip("/") + "/") if len(sys.argv) > 1 else "./"  # katalog z alerts.csv, insider_trades.csv, tickers.csv
random.seed(1)

def f(x):
    try: return float(x)
    except: return None

def pdt(s):
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try: return dt.datetime.strptime(s, fmt)
        except: pass
    return None

tickers = {r["symbol"]: r for r in csv.DictReader(open(D + "tickers.csv"))}
trades = list(csv.DictReader(open(D + "insider_trades.csv")))
for t in trades:
    t["td"] = pdt(t["transactionDate"]); t["ca"] = pdt(t["collectedAt"]); t["val"] = f(t["totalValue"]) or 0.0
alerts = list(csv.DictReader(open(D + "alerts.csv")))

CS = [re.compile(p, re.I) for p in [
    r"\bChief\s+(Executive|Financial|Operating|Technology|Information|Medical|Scientific|Legal|Accounting)\s+Officer\b",
    r"\b(CEO|CFO|COO|CTO|CIO|CMO|CSO|CLO)\b", r"\bChair(man|woman|person)\b",
    r"\b(EVP|Executive\s+Vice\s+President)[\s,]+.*?(Finance|Operations?|Product|Strategy)\b",
    r"\bPrincipal\s+(Financial|Accounting)\s+Officer\b"]]
FUND = re.compile(r"(CAPITAL|FUND|\bLP\b|L\.P\.|LLC|PARTNERS|ADVISORS|MANAGEMENT|HOLDINGS|TRUST)", re.I)

def is_cs(role):
    if not role: return False
    if any(p.search(role) for p in CS): return True
    return re.search(r"\bPresident\b", re.sub(r"(Vice|Senior)\s+President", "", role, flags=re.I), re.I) is not None

rows = []
for a in alerts:
    p = {k: f(a[k]) for k in ("priceAtAlert", "price1h", "price4h", "price1d", "price3d", "price7d",
                               "xbiAtAlert", "xbi7d", "ibbAtAlert", "ibb7d", "xbi3d", "ibb3d")}
    if p["price7d"] is None or p["priceAtAlert"] is None: continue
    frozen = len({p["price1h"], p["price4h"], p["price1d"], p["price3d"], p["price7d"]}) == 1
    d = 1 if a["alertDirection"] == "positive" else -1
    sent = pdt(a["sentAt"])
    raw = (p["price7d"] - p["priceAtAlert"]) / p["priceAtAlert"] * 100
    raw3 = (p["price3d"] - p["priceAtAlert"]) / p["priceAtAlert"] * 100 if p["price3d"] else None
    xbiw = (p["xbi7d"] - p["xbiAtAlert"]) / p["xbiAtAlert"] * 100 if p["xbi7d"] and p["xbiAtAlert"] else None
    ibbw = (p["ibb7d"] - p["ibbAtAlert"]) / p["ibbAtAlert"] * 100 if p["ibb7d"] and p["ibbAtAlert"] else None
    real = (p["price7d"] - p["price1h"]) / p["price1h"] * 100 * d if p["price1h"] else None
    gap = (p["price1h"] - p["priceAtAlert"]) / p["priceAtAlert"] * 100 * d if p["price1h"] else None
    sym = a["symbol"]; tk = tickers.get(sym, {})
    r = dict(id=int(a["id"]), symbol=sym, rule=a["ruleName"], sent=sent, dir=d, dirs=a["alertDirection"],
             ndr=a["nonDeliveryReason"] or "delivered", delivered=a["delivered"] == "t",
             sector=tk.get("sector", "?"), rdzen_plus="rdzeń+" in (tk.get("notes") or ""),
             signed=raw * d, signed3=raw3 * d if raw3 is not None else None, hit=raw * d > 0,
             alpha=(raw - xbiw) * d if xbiw is not None else None, alpha_ibb=(raw - ibbw) * d if ibbw is not None else None,
             xbiw=xbiw, real=real, net=real - 1 if real is not None else None, gap=gap, frozen=frozen,
             trigger=re.sub(r"\\(.)", r"\1", a["trigger_insider"] or ""), role=None, is_cs=False, is_fund=False, tier=None, latency=None, fund_names="")
    # atrybucja roli: transakcja wyzwalająca (nazwisko z nagłówka), BUY, okno 14d
    if r["rule"] == "Form 4 Insider BUY":
        win = [t for t in trades if t["symbol"] == sym and t["transactionType"] == "BUY" and t["td"]
               and sent.date() - dt.timedelta(days=14) <= t["td"].date() <= sent.date()]
        trig = [t for t in win if r["trigger"] and t["insiderName"].upper() == r["trigger"].upper()]
        same = [t for t in trig if t["ca"] and t["ca"].replace(second=0, microsecond=0) == sent.replace(second=0, microsecond=0)]
        grp = same or trig
        if grp:
            r["role"] = max((t["insiderRole"] or "" for t in grp), key=len)
            r["is_cs"] = is_cs(r["role"])
            gv = sum(t["val"] for t in grp)
            r["tier"] = "T1" if gv >= 500000 else "T2"
            r["group_value"] = gv
            r["latency"] = (sent.date() - max(t["td"].date() for t in grp)).days
        r["is_fund"] = any(FUND.search(t["insiderName"]) for t in win)
        r["fund_names"] = "|".join(sorted({t["insiderName"] for t in win if FUND.search(t["insiderName"])}))
    rows.append(r)

excluded = [r for r in rows if r["frozen"]]
rows = [r for r in rows if not r["frozen"]]
print(f"# Próbka: {len(alerts)} alertów od 09.06, {len(rows)+len(excluded)} z 7d, wykluczone price_frozen: {[(r['symbol'], r['id']) for r in excluded]}")
print(f"# Ostatni alert z 7d: {max(r['sent'] for r in rows)}; bez 7d: {[(a['symbol'], a['id'], a['sentAt'][:10]) for a in alerts if not f(a['price7d'])]}")

def events(rs):
    """symbol + kierunek, łańcuch ≤7 dni po sentAt → średnia metryk."""
    out = []
    by = defaultdict(list)
    for r in sorted(rs, key=lambda x: x["sent"]): by[(r["symbol"], r["dir"])].append(r)
    for k, lst in by.items():
        cur = [lst[0]]
        for r in lst[1:]:
            if (r["sent"] - cur[-1]["sent"]) <= dt.timedelta(days=7): cur.append(r)
            else: out.append(cur); cur = [r]
        out.append(cur)
    ev = []
    for grp in out:
        def m(key):
            v = [g[key] for g in grp if g[key] is not None]
            return sum(v) / len(v) if v else None
        ev.append(dict(symbol=grp[0]["symbol"], ids=[g["id"] for g in grp], n=len(grp), first=grp[0]["sent"],
                       signed=m("signed"), signed3=m("signed3"), alpha=m("alpha"), alpha_ibb=m("alpha_ibb"), xbiw=m("xbiw"),
                       real=m("real"), net=m("net"), gap=m("gap"), delivered=any(g["delivered"] for g in grp),
                       is_cs=any(g["is_cs"] for g in grp), tier=grp[0]["tier"], role=grp[0]["role"]))
    return ev

def boot_ci(vals, fn=st.mean, B=5000):
    if len(vals) < 2: return (None, None)
    s = sorted(fn(random.choices(vals, k=len(vals))) for _ in range(B))
    return (s[int(0.025 * B)], s[int(0.975 * B)])

def fmt(x, pl=True):
    if x is None: return "—"
    return f"{x:+.2f}" if pl else f"{x:.2f}"

def seg(name, rs, ci=False):
    ev = events(rs)
    if not ev:
        print(f"| {name} | 0/0 | — | — | — | — | — | — | — |"); return
    sg = [e["signed"] for e in ev]; al = [e["alpha"] for e in ev if e["alpha"] is not None]
    ib = [e["alpha_ibb"] for e in ev if e["alpha_ibb"] is not None]
    rl = [e["real"] for e in ev if e["real"] is not None]; xb = [e["xbiw"] for e in ev if e["xbiw"] is not None]
    hit = sum(1 for e in ev if e["signed"] > 0) / len(ev) * 100
    chase = sum(1 for r in rs if r["gap"] is not None and r["gap"] > 3)
    ci_s = f" [{fmt(boot_ci(sg)[0])},{fmt(boot_ci(sg)[1])}]" if ci and len(sg) > 2 else ""
    ci_a = f" [{fmt(boot_ci(al)[0])},{fmt(boot_ci(al)[1])}]" if ci and len(al) > 2 else ""
    ci_r = f" [{fmt(boot_ci(rl, st.median)[0])},{fmt(boot_ci(rl, st.median)[1])}]" if ci and len(rl) > 2 else ""
    apos = sum(1 for x in al if x > 0) / len(al) * 100 if al else 0
    print(f"| {name} | {len(rs)}/{len(ev)} | {fmt(st.mean(sg))}{ci_s} · {fmt(st.median(sg))} | {hit:.0f}% | "
          f"{fmt(st.mean(al)) if al else '—'}{ci_a} · **{fmt(st.median(al)) if al else '—'}** · {apos:.0f}% | "
          f"{fmt(st.mean(ib)) if ib else '—'} | {fmt(st.mean(xb)) if xb else '—'} | "
          f"{fmt(st.mean(rl)) if rl else '—'} · **med {fmt(st.median(rl)) if rl else '—'}**{ci_r} · NET med {fmt(st.median(rl)-1) if rl else '—'} | {chase}/{len(rs)} |")
    return ev

HDR = "| Segment | A/E | signed 7d śr [CI] · med | hit | α XBI śr [CI] · **med** · α>0 | α IBB śr | XBI okno | REAL śr · **med** [CI] · NET med | chase>3% |\n|---|---|---|---|---|---|---|---|---|"

F4 = [r for r in rows if r["rule"] == "Form 4 Insider BUY" and r["sector"] in ("healthcare", "healthcare_discovery", "biotech_apls")]
nofund = [r for r in F4 if not r["is_fund"]]
cs = [r for r in nofund if r["is_cs"]]
dirs_only = [r for r in nofund if not r["is_cs"]]
disc = [r for r in nofund if r["sector"] in ("healthcare_discovery", "biotech_apls")]
fund = [r for r in F4 if r["is_fund"]]
deliv = [r for r in rows if r["delivered"]]
rp = [r for r in nofund if r["rdzen_plus"]]

for label, cut in (("CAŁA PRÓBKA post-fix (od 09.06)", dt.datetime(2026, 6, 9)), ("FORWARD po werdykcie #1 (sentAt ≥ 01.09)", dt.datetime(2026, 9, 1))):
    print(f"\n## {label}\n" + HDR)
    c = lambda rs: [r for r in rs if r["sent"] >= cut]
    seg("Delivered (produkt)", c(deliv), ci=True)
    seg("Delivered Form 4 BUY (grywalne wg REGUŁ)", c([r for r in deliv if r["rule"] == "Form 4 Insider BUY"]))
    seg("**Form 4 BUY klasa (bez FUND)**", c(nofund), ci=True)
    seg("├ C-suite BUY", c(cs), ci=True)
    seg("├ C-suite T1 (≥$500K)", c([r for r in cs if r["tier"] == "T1"]))
    seg("├ C-suite T2 ($100-500K)", c([r for r in cs if r["tier"] == "T2"]))
    seg("└ Director/other-only BUY", c(dirs_only), ci=True)
    seg("Discovery+APLS osobowa", c(disc), ci=True)
    seg("├ discovery C-suite", c([r for r in disc if r["is_cs"]]))
    seg("└ discovery Director-only", c([r for r in disc if not r["is_cs"]]))
    seg("Rdzeń+ tickery (PFE BSX COR ELAN COO SMMT), bez FUND", c(rp))
    seg("├ rdzeń+ large-cap z sentAt ≥ 19.10 (po promocji)", [r for r in rp if r["sent"] >= dt.datetime(2026, 10, 19)])
    seg("Discovery FUNDUSZOWA", c(fund))
    seg("Form 4 SELL (short)", c([r for r in rows if r["rule"] == "Form 4 Insider Signal"]))
    seg("8-K wszystkie", c([r for r in rows if r["rule"].startswith("8-K")]))

print("\n## Per reguła × kierunek (cała próbka)\n| Reguła · kierunek | A/E | s3d | s7d śr · med | hit | α śr · med | α IBB | XBI | REAL śr · med |\n|---|---|---|---|---|---|---|---|---|")
by = defaultdict(list)
for r in rows: by[(r["rule"], r["dirs"])].append(r)
for k in sorted(by, key=lambda k: -len(by[k])):
    rs = by[k]; ev = events(rs)
    sg = [e["signed"] for e in ev]; s3 = [e["signed3"] for e in ev if e["signed3"] is not None]
    al = [e["alpha"] for e in ev if e["alpha"] is not None]; ib = [e["alpha_ibb"] for e in ev if e["alpha_ibb"] is not None]
    rl = [e["real"] for e in ev if e["real"] is not None]; xb = [e["xbiw"] for e in ev if e["xbiw"] is not None]
    print(f"| {k[0]} · {'BULL' if k[1]=='positive' else 'BEAR'} | {len(rs)}/{len(ev)} | {fmt(st.mean(s3)) if s3 else '—'} | {fmt(st.mean(sg))} · {fmt(st.median(sg))} | "
          f"{sum(1 for e in ev if e['signed']>0)/len(ev)*100:.0f}% | {fmt(st.mean(al)) if al else '—'} · {fmt(st.median(al)) if al else '—'} | {fmt(st.mean(ib)) if ib else '—'} | {fmt(st.mean(xb)) if xb else '—'} | {fmt(st.mean(rl)) if rl else '—'} · {fmt(st.median(rl)) if rl else '—'} |")

print("\n## Bramki tłumiące (nonDeliveryReason, cała próbka) — forward od 01.09 w nawiasie\n| powód | A/E (fwd) | s7d śr · med | hit (fwd) | α śr · med | REAL śr · med | XBI |\n|---|---|---|---|---|---|---|")
by = defaultdict(list)
for r in rows: by[r["ndr"]].append(r)
for k in sorted(by, key=lambda k: -len(by[k])):
    rs = by[k]; ev = events(rs); fw = [r for r in rs if r["sent"] >= dt.datetime(2026, 9, 1)]; evf = events(fw)
    sg = [e["signed"] for e in ev]; al = [e["alpha"] for e in ev if e["alpha"] is not None]
    rl = [e["real"] for e in ev if e["real"] is not None]; xb = [e["xbiw"] for e in ev if e["xbiw"] is not None]
    hitf = f"{sum(1 for e in evf if e['signed']>0)}/{len(evf)}" if evf else "—"
    print(f"| {k} | {len(rs)}/{len(ev)} ({len(fw)}) | {fmt(st.mean(sg))} · {fmt(st.median(sg))} | {sum(1 for e in ev if e['signed']>0)/len(ev)*100:.0f}% ({hitf}) | "
          f"{fmt(st.mean(al)) if al else '—'} · {fmt(st.median(al)) if al else '—'} | {fmt(st.mean(rl)) if rl else '—'} · {fmt(st.median(rl)) if rl else '—'} | {fmt(st.mean(xb)) if xb else '—'} |")

print("\n## Reżim miesięczny (alerty bycze)\n| Miesiąc | A | XBI okno | signed 7d | α XBI śr · med | REAL śr |\n|---|---|---|---|---|---|")
by = defaultdict(list)
for r in rows:
    if r["dir"] == 1: by[r["sent"].strftime("%Y-%m")].append(r)
for k in sorted(by):
    rs = by[k]; al = [r["alpha"] for r in rs if r["alpha"] is not None]; rl = [r["real"] for r in rs if r["real"] is not None]
    xb = [r["xbiw"] for r in rs if r["xbiw"] is not None]
    print(f"| {k} | {len(rs)} | {fmt(st.mean(xb)) if xb else '—'} | {fmt(st.mean([r['signed'] for r in rs]))} | {fmt(st.mean(al)) if al else '—'} · {fmt(st.median(al)) if al else '—'} | {fmt(st.mean(rl)) if rl else '—'} |")

print("\n## Teczki\n- Reżim IX-X (α byczych med ≥+2pp przy N≥12):", end=" ")
ix = [r for r in rows if r["dir"] == 1 and r["sent"] >= dt.datetime(2026, 9, 1) and r["alpha"] is not None]
print(f"N={len(ix)} alertów, med α {fmt(st.median([r['alpha'] for r in ix])) if ix else '—'}, śr {fmt(st.mean([r['alpha'] for r in ix])) if ix else '—'}")
stale = [r for r in F4 if r["latency"] is not None and r["latency"] > 30]
print(f"- Stale-filing trap (latencja >30d, próg ≥3): {len(stale)} → {[(r['symbol'], r['id'], r['latency']) for r in stale]}")
me = [r for r in rows if r["ndr"] == "material_event_obs"]
print(f"- 8-K Material Event obs (N≥10 → decyzja): N={len(me)} od 01.09; łącznie 'Material Event GPT' z 7d: {sum(1 for r in rows if 'Material' in r['rule'])}")
gb = [e for e in events(cs) if e["gap"] is not None]
hi = [e["real"] for e in gb if e["gap"] > 7]; lo = [e["real"] for e in gb if e["gap"] <= 7]
print(f"- Gap-band C-suite: gap>7%: N={len(hi)} śr REAL {fmt(st.mean(hi)) if hi else '—'} · ≤7%: N={len(lo)} śr REAL {fmt(st.mean(lo)) if lo else '—'}")
bl = [r for r in rows if r["ndr"] in ("bullish_8k_no_edge", "bullish_no_consensus_data", "gpt_missing_data", "consensus_miss") and r["dir"] == 1]
evb = events(bl)
print(f"- Bullish-8K pełne query (4 powody, positive): A/E {len(bl)}/{len(evb)}, hit {sum(1 for e in evb if e['signed']>0)/len(evb)*100:.0f}%, signed śr {fmt(st.mean([e['signed'] for e in evb]))}, α med {fmt(st.median([e['alpha'] for e in evb if e['alpha'] is not None]))}")

print("\n## Werdykt systemowy #2 — kryterium: klasa Form 4 BUY bez FUND, N≥20 zdarzeń: hit <60% LUB med REAL ≤ −1% → „bez edge”")
ev = events(nofund); rl = [e["real"] for e in ev if e["real"] is not None]
hit = sum(1 for e in ev if e["signed"] > 0) / len(ev) * 100
print(f"N={len(ev)} zdarzeń ({len(nofund)} alertów), hit {hit:.0f}%, med REAL {fmt(st.median(rl))} (NET med {fmt(st.median(rl)-1)}), śr REAL {fmt(st.mean(rl))}, CI med REAL {boot_ci(rl, st.median)}")
print("→", "BEZ EDGE (stop gry wg REGUŁ §5)" if len(ev) >= 20 and (hit < 60 or st.median(rl) <= -1) else ("N<20 → insufficient" if len(ev) < 20 else "kryterium 'bez edge' NIE spełnione → kontynuacja"))

print("\n## Lista zdarzeń Form 4 BUY bez FUND (chronologicznie)\n| first | symbol | ids | sektor | rola wyzwalacza | tier | CS | deliv | signed | α | gap | REAL |\n|---|---|---|---|---|---|---|---|---|---|---|---|")
for e in sorted(ev, key=lambda e: e["first"]):
    r0 = next(r for r in nofund if r["id"] == e["ids"][0])
    print(f"| {e['first']:%m-%d} | {e['symbol']} | {','.join(map(str, e['ids']))} | {r0['sector'][:10]}{'/R+' if r0['rdzen_plus'] else ''} | {(e['role'] or '?')[:28]} | {e['tier'] or '?'} | {'C' if e['is_cs'] else '-'} | {'D' if e['delivered'] else '-'} | {fmt(e['signed'])} | {fmt(e['alpha'])} | {fmt(e['gap'])} | {fmt(e['real'])} |")

print("\n## FUND alerty:", [(r["symbol"], r["id"], r["fund_names"][:40]) for r in fund])
print("## Form 4 BUY bez roli (brak dopasowania wyzwalacza):", [(r["symbol"], r["id"], r["trigger"]) for r in F4 if r["role"] is None])
print("## Alerty Form 4 BUY poza sektorami healthcare*:", [(r["symbol"], r["id"], r["sector"]) for r in rows if r["rule"] == "Form 4 Insider BUY" and r not in F4])

print("\n## WRAŻLIWOŚĆ werdyktu systemowego (klasa Form 4 BUY bez FUND)")
def crit(name, rs, ev_fn=events):
    ev = ev_fn(rs); rl = [e["real"] for e in ev if e["real"] is not None]
    if not ev: print(f"| {name} | 0 | — | — | — |"); return
    hit = sum(1 for e in ev if e["signed"] > 0) / len(ev) * 100
    flag = "BEZ EDGE" if len(ev) >= 20 and (hit < 60 or st.median(rl) <= -1) else ("N<20" if len(ev) < 20 else "nie")
    print(f"| {name} | {len(ev)} | {hit:.0f}% | {fmt(st.median(rl))} (śr {fmt(st.mean(rl))}) | {flag} |")
print("| wariant | E | hit | med REAL (śr) | kryterium |\n|---|---|---|---|---|")
crit("A: bazowy (zdarzenia symbol+kierunek ≤7d po sentAt)", nofund)
crit("B: bez sklejania (każdy alert = zdarzenie)", nofund, lambda rs: [dict(signed=r["signed"], real=r["real"]) for r in rs])
crit("C: z FUND", F4)
crit("D: bez PRE (brak na XTB)", [r for r in nofund if r["symbol"] != "PRE"])
crit("E: tylko wchodzalne (gap ≤3%)", [r for r in nofund if r["gap"] is not None and r["gap"] <= 3])
crit("F: tylko forward ≥01.09", [r for r in nofund if r["sent"] >= dt.datetime(2026, 9, 1)])
crit("G: tylko in-sample <01.09", [r for r in nofund if r["sent"] < dt.datetime(2026, 9, 1)])
crit("H: bez discovery (core + rdzeń+)", [r for r in nofund if r["sector"] == "healthcare"])
crit("I: tylko T1 ≥$500K (rola dopasowana)", [r for r in nofund if r["tier"] == "T1"])
ev = events(nofund); rl = sorted([e["real"] for e in ev]); 
print("REAL posortowane:", [round(x, 1) for x in rl])
print("suma PLN @2200 na zdarzenie (NET):", round(sum((x - 1) / 100 * 2200 for x in rl)))
print("Wilcoxon-ish: P(med REAL>0) bootstrap =", sum(1 for _ in range(5000) if st.median(random.choices(rl, k=len(rl))) > 0) / 5000)
