"""Sorting lines of the depots as a graph in the hall frame (phase 7d step 5d, ADR-071).

Nodes are the parts of the line (inputs, collector, loop, scanner or scan tunnel, exits, chutes,
manual sorting, decoding station, staging places), edges are belts with a length and a speed, a
gravity chute or a manual carry. The simulator walks a parcel through the graph (telematics
`simulator/line.ts`), the digital shadow draws it. Checkpoints are devices in db-telemetry.

Budimír has two variants: `current` after the team's sketch (docs/design/nacrt-linka-budimir.png)
turned to the layout of the hall (ramps on the -y wall: LD-01..03 linehaul BB, BA, ZA, LD-04..08
transits; courier bays on the +y wall), and `proposal` (Depot 5.0: scan tunnel, recirculation,
wheel sorters with chutes, a counter at every input and output). The other depots get a line that
fits their hall, `current` only.
"""

import itertools
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

# belt speeds (m/s)
FEED, BELT, LOOP, TELESCOPIC, CHUTE, WALK = 1.2, 1.5, 2.0, 0.8, 1.0, 1.0
TUNNEL_READ = 0.995  # multi-sided tunnel; the overhead scanner uses the simulator's line rate
MANUAL_SORT = (180, 720)  # seconds a worker needs to sort one parcel by hand in the area
DECODE = (60, 240)  # reading a label by hand at the decoding station


class DoorLike(Protocol):
    @property
    def code(self) -> str: ...
    @property
    def kind(self) -> str: ...
    @property
    def x(self) -> float: ...
    @property
    def y(self) -> float: ...


def _r(v: float) -> float:
    return round(v, 1)


@dataclass
class Graph:
    label: str
    nodes: list[dict[str, object]]
    edges: list[dict[str, object]]
    zones: list[dict[str, object]]

    def node(self, nid: str, kind: str, x: float, y: float, **extra: object) -> str:
        assert all(n["id"] != nid for n in self.nodes), nid
        self.nodes.append({"id": nid, "kind": kind, "x": _r(x), "y": _r(y)} | extra)
        return nid

    def at(self, nid: str) -> tuple[float, float]:
        n = next(n for n in self.nodes if n["id"] == nid)
        return float(n["x"]), float(n["y"])  # type: ignore[arg-type]

    def edge(
        self,
        a: str,
        b: str,
        kind: str = "belt",
        speed: float = BELT,
        via: Sequence[tuple[float, float]] = (),
        raised: bool = False,
    ) -> None:
        pts = [self.at(a), *via, self.at(b)]
        length = sum(math.dist(p, q) for p, q in itertools.pairwise(pts))
        e: dict[str, object] = {
            "from": a,
            "to": b,
            "kind": kind,
            "speed": speed,
            "length": _r(max(length, 0.5)),
            "points": [[_r(x), _r(y)] for x, y in pts],
        }
        if raised:
            e["raised"] = True
        self.edges.append(e)

    def zone(self, kind: str, label: str, x0: float, y0: float, x1: float, y1: float) -> None:
        r = [_r(min(x0, x1)), _r(min(y0, y1)), _r(max(x0, x1)), _r(max(y0, y1))]
        self.zones.append({"kind": kind, "label": label, "rect": r})

    def out(self) -> dict[str, object]:
        return {"label": self.label, "nodes": self.nodes, "edges": self.edges, "zones": self.zones}


def _loop(g: Graph, ids: list[tuple[str, str, float, float, dict[str, object]]]) -> None:
    """Nodes of a closed loop in the order of flow, joined by loop edges (last back to first)."""
    for nid, kind, x, y, extra in ids:
        g.node(nid, kind, x, y, **extra)
    for (a, *_), (b, *_) in zip(ids, ids[1:] + ids[:1], strict=True):
        g.edge(a, b, "loop", LOOP)


def _budimir(doors: dict[str, DoorLike], proposal: bool) -> Graph:
    """Budimír. Loop between the ramps and the courier bays, flowing clockwise when seen from
    above: the section by the ramps (y = -9) runs west, the inner one (y = -1) east."""
    g = Graph("Návrh Depot 5.0" if proposal else "Súčasný stav", [], [], [])
    yr, yb = doors["LD-01"].y, doors["SB-01"].y  # ramp wall, courier bays
    up, low, west, east = yr + 6.3, yr + 14.3, -48.0, -14.0  # loop straights
    lx = {c: doors[c].x for c in ("LD-01", "LD-02", "LD-03")}

    def cp(code: str) -> dict[str, object]:
        """Counters at the inputs exist only in the proposal."""
        return {"checkpoint": code} if proposal else {}

    # the loop; the overhead scanner (current) or the tunnel (proposal) right after the east bend
    scanner: dict[str, object] = (
        {"checkpoint": "CP-BUD-TUN", "read": TUNNEL_READ, "label": "Skenovací tunel"}
        if proposal
        else {"checkpoint": "LINE-SCN-01", "read": "line", "label": "Skener na mostíku"}
    )
    loop: list[tuple[str, str, float, float, dict[str, object]]] = [
        ("L-UE", "loop", east, up, {}),
        ("SC", "tunnel" if proposal else "scanner", east - 4, up, scanner),
        ("X3", "exit", lx["LD-03"] + 1, up, {"serves": ["LD-03"]}),
        ("X2", "exit", lx["LD-02"] + 1, up, {"serves": ["LD-02"]}),
        ("X1", "exit", west + 1, up, {"serves": ["LD-01"]}),
        ("L-UW", "loop", west, up, {}),
        ("L-W", "loop", west - 4, (up + low) / 2, {}),
        ("L-LW", "loop", west, low, {}),
    ]
    if proposal:
        loop.append(("RX", "exit", west + 0.8, low, {"reject": True, "label": "Vyradenie"}))
    loop += [
        ("MZ", "merge", west + 4, low, {}),
        # current: one exit "Prechody + KE" to the manual area; proposal: the sorter line
        (
            "XP",
            "exit",
            east - 2,
            low,
            {"label": "Triediaca vetva"}
            if proposal
            else {"default": True, "label": "Prechody + KE"},
        ),
        ("L-LE", "loop", east, low, {}),
        ("L-E", "loop", east + 4, (up + low) / 2, {}),
    ]
    _loop(g, loop)

    # linehaul exits: belts to the docks LD-01..03, the dock scanners at their ends
    for i, code in enumerate(("LD-01", "LD-02", "LD-03"), start=1):
        x = lx[code] + 1
        g.node(
            f"D{i}",
            "staging",
            x,
            yr + 1.2,
            door=code,
            checkpoint=f"DOCK-SCN-0{i}",
            label=code,
        )
        ex = "X1" if i == 1 else f"X{i}"
        via = [(x, up)] if i == 1 else []
        g.edge(ex, f"D{i}", "belt", BELT, via=via)

    # courier inputs K1..K4: courier doors SB-01..04, short feeds into the collector
    yc = yb - 5.0
    prev: str | None = None
    for i in (4, 3, 2, 1):
        code = f"SB-0{i}"
        x = doors[code].x
        g.node(f"K{i}", "input", x, yb - 0.3, door=code, label=f"K{i}", **cp(f"CP-BUD-K{i}"))
        g.node(f"C{i}", "merge", x, yc)
        g.edge(f"K{i}", f"C{i}", "feed", FEED)
        if prev:
            g.edge(prev, f"C{i}", "belt", BELT)
        prev = f"C{i}"
    g.node(
        "ZB",
        "counter",
        west - 2,
        yc,
        checkpoint="CP-BUD-ZB",
        label="Koniec zberného pásu",
    )
    g.edge("C1", "ZB", "belt", BELT)
    g.node("J2", "merge", west - 2, low + 2.5)
    g.edge("ZB", "J2", "belt", BELT)
    g.edge("J2", "MZ", "belt", BELT, via=[(west + 2, low)])

    # night linehaul trucks: telescopic belts at LD-01..03 onto the raised platform
    g.zone(
        "platform", "Plošina nočných kamiónov", lx["LD-01"] - 3, yr + 0.4, lx["LD-03"] + 3, yr + 3.6
    )
    py = yr + 2.6
    tprev: str | None = None
    for i, code in ((3, "LD-03"), (2, "LD-02"), (1, "LD-01")):
        x = lx[code] - 2.5
        g.node(f"T{i}", "input", x, yr + 1.0, door=code, label=f"T{i}", **cp(f"CP-BUD-T{i}"))
        g.node(f"P{i}", "merge", x, py)
        g.edge(f"T{i}", f"P{i}", "telescopic", TELESCOPIC, raised=True)
        if tprev:
            g.edge(tprev, f"P{i}", "belt", BELT, raised=True)
        tprev = f"P{i}"
    g.node("PW", "merge", west - 7, py)
    g.edge("P1", "PW", "belt", BELT, raised=True)
    g.edge("PW", "J2", "belt", BELT, via=[(west - 7, low + 2.5)])

    # transit pickups in the afternoon (G1, G2 at LD-04/05) and carts from the back (M)
    jx = east + 8
    g.node("J", "merge", jx, (up + low) / 2)
    g.edge("J", "L-E", "belt", BELT)
    gy = yr + 4.0
    g.node("GM", "merge", jx, gy)
    g.edge("GM", "J", "belt", BELT)
    for i, code in ((1, "LD-04"), (2, "LD-05")):
        x = doors[code].x
        g.node(f"G{i}", "input", x, yr + 1.0, door=code, label=f"G{i}", **cp(f"CP-BUD-G{i}"))
        g.edge(f"G{i}", "GM", "feed", FEED, via=[(x, gy)])
    g.node("M", "input", jx + 10, (up + low) / 2, label="M · ručný vstup", **cp("CP-BUD-M"))
    g.edge("M", "J", "feed", FEED)

    # staging of the transits (LD-04..08) and of the Košice couriers (SB-01..08)
    staging: list[str] = []
    for code in ("LD-04", "LD-05", "LD-06", "LD-07", "LD-08"):
        x = doors[code].x + 2.5
        staging.append(g.node(f"S-{code}", "staging", x, yr + 2.5, door=code, label=code))
    for i in range(1, 9):
        code = f"SB-0{i}"
        staging.append(
            g.node(f"S-{code}", "staging", doors[code].x + 3, yb - 1.4, door=code, label=code)
        )
    g.zone("office", "Kancelária", -60.0, yb - 6, west - 6, yb + 3.5)

    if not proposal:
        # one exit to the manual area right of the line: transits and Košice by hand
        g.node("MAN", "manual", 4.0, low + 2.5, handling=list(MANUAL_SORT), label="Ručné triedenie")
        g.edge("XP", "MAN", "belt", BELT, via=[(east - 2, low + 2.5)])
        g.zone("manual", "Prechody + KE · ručné triedenie", 0.0, up - 2, 56.0, low + 6)
        for s in [*staging, "D1", "D2", "D3"]:
            g.edge("MAN", s, "manual", WALK)
        return g

    # proposal: the sorter line east with wheel sorters and chutes (no manual sorting)
    sy = low + 2.5
    g.node("SL", "merge", east - 2, sy)
    g.edge("XP", "SL", "belt", BELT)
    last = "SL"
    by_x = sorted(
        [(doors[c].x + 2.5, c, "N") for c in ("LD-04", "LD-05", "LD-06", "LD-07", "LD-08")]
        + [(doors[f"SB-0{i}"].x + 3, f"SB-0{i}", "S") for i in range(4, 9)]
    )
    for x, code, _side in by_x:
        nid = f"E-{code}"
        tag = code.replace("-", "")
        g.node(nid, "exit", x - 1.2, sy, serves=[code], checkpoint=f"CP-BUD-{tag}", label=code)
        g.edge(last, nid, "belt", BELT)
        g.edge(nid, f"S-{code}", "chute", CHUTE)
        last = nid
    g.node("SL-END", "exit", 56.0, sy, label="Koniec vetvy")
    g.edge(last, "SL-END", "belt", BELT)
    # SB-01..03 lie under the loop: wheel sorters on its inner section, chutes over the collector
    for i in (1, 2, 3):
        code = f"SB-0{i}"
        x = doors[code].x + 3
        g.node(f"E-{code}", "exit", x, low, serves=[code], checkpoint=f"CP-BUD-SB0{i}", label=code)
        g.edge(f"E-{code}", f"S-{code}", "chute", CHUTE)
    _splice(g, "RX", "MZ", ["E-SB-01"])
    _splice(g, "MZ", "XP", ["E-SB-02", "E-SB-03"])
    # unread twice: off the loop to the decoding station by the office
    dk = g.node(
        "DK",
        "decode",
        west - 9.5,
        low + 1,
        checkpoint="CP-BUD-DEK",
        handling=list(DECODE),
        label="Dekódovanie",
    )
    g.edge("RX", dk, "chute", CHUTE, via=[(west + 0.8, low + 1)], raised=True)
    g.edge("SL-END", dk, "manual", WALK)
    for s in [*staging, "D1", "D2", "D3"]:
        g.edge(dk, s, "manual", WALK)
    return g


def _splice(g: Graph, a: str, b: str, mids: list[str]) -> None:
    """Put nodes into the loop edge a -> b (in flow order)."""
    edge = next(e for e in g.edges if e["from"] == a and e["to"] == b)
    g.edges.remove(edge)
    for p, q in zip([a, *mids], [*mids, b], strict=True):
        g.edge(p, q, "loop", LOOP)


def _inward(d: DoorLike, facing: float, k: float) -> tuple[float, float]:
    r = math.radians(facing)
    return d.x - math.cos(r) * k, d.y - math.sin(r) * k


def _straight(
    code: str, doors: dict[str, DoorLike], facing: dict[str, float], short: bool
) -> Graph:
    """A straight belt from the ramps nearest to the courier bays. `short`: the belt only brings
    the parcels to a sorting table by the bays (Dunajská Streda, Trenčín), otherwise it has a
    scanner and one exit with a chute per bay (Žilina, Ivanka). Unread parcels end on the table."""
    g = Graph("Súčasný stav", [], [], [])
    bays = sorted((d for d in doors.values() if d.kind == "staging_bay"), key=lambda d: d.code)
    ramps = [d for d in doors.values() if d.kind == "loading_dock"]
    bx = sum(d.x for d in bays) / len(bays)
    by = sum(d.y for d in bays) / len(bays)
    ramps.sort(key=lambda d: math.dist((d.x, d.y), (bx, by)))
    inputs = sorted(ramps[: min(2, len(ramps))], key=lambda d: d.code)
    p = code.replace("BAH", "BA")
    # the belt runs along the line from the inputs towards the bays, 6 m inside the ramp wall
    starts = [_inward(d, facing[d.code], 6.0) for d in inputs]
    sx, sy = sum(x for x, _ in starts) / len(starts), sum(y for _, y in starts) / len(starts)
    stage = {d.code: _inward(d, facing[d.code], 2.5) for d in bays}
    tx, ty = (
        sum(x for x, _ in stage.values()) / len(stage),
        sum(y for _, y in stage.values()) / len(stage),
    )
    hx, hy = tx - sx, ty - sy
    span = math.hypot(hx, hy)
    ux, uy = hx / span, hy / span
    end = max(span - 7.0, span * 0.6)
    g.node("IN", "merge", sx, sy)
    for i, d in enumerate(inputs, start=1):
        g.node(f"I{i}", "input", *_inward(d, facing[d.code], 1.0), door=d.code, label=d.code)
        g.edge(f"I{i}", "IN", "telescopic", TELESCOPIC)
    g.node("CNT", "counter", sx + ux * 3, sy + uy * 3, checkpoint=f"CP-{p}-IN", label="Vstup")
    g.edge("IN", "CNT", "belt", BELT)
    for code_, (x, y) in stage.items():
        g.node(f"S-{code_}", "staging", x, y, door=code_, label=code_)
    table_at = (sx + ux * end, sy + uy * end)
    g.node(
        "MAN", "manual", *table_at, handling=list(MANUAL_SORT), default=True, label="Triediaci stôl"
    )
    if short:
        g.edge("CNT", "MAN", "belt", BELT)
        g.zone(
            "manual",
            "Ručné triedenie",
            table_at[0] - 4,
            table_at[1] - 4,
            table_at[0] + 4,
            table_at[1] + 4,
        )
        for s in stage:
            g.edge("MAN", f"S-{s}", "manual", WALK)
        return g
    g.node(
        "SC",
        "scanner",
        sx + ux * 8,
        sy + uy * 8,
        checkpoint=f"CP-{p}-SCN",
        read="line",
        label="Skener",
    )
    g.edge("CNT", "SC", "belt", BELT)
    last = "SC"
    n = len(bays)
    for i, d in enumerate(bays):
        f = 12 + (end - 14) * (i + 1) / (n + 1)
        nid = f"E-{d.code}"
        g.node(nid, "exit", sx + ux * f, sy + uy * f, serves=[d.code], label=d.code)
        g.edge(last, nid, "belt", BELT)
        g.edge(nid, f"S-{d.code}", "chute", CHUTE)
        last = nid
    g.edge(last, "MAN", "belt", BELT)
    for s in stage:
        g.edge("MAN", f"S-{s}", "manual", WALK)
    return g


def line_of(code: str, doors: Sequence[DoorLike], facing: dict[str, float]) -> dict[str, object]:
    by_code = {d.code: d for d in doors}
    if code == "BUD":
        variants = {
            "current": _budimir(by_code, False).out(),
            "proposal": _budimir(by_code, True).out(),
        }
    else:
        variants = {"current": _straight(code, by_code, facing, short=code in ("DS", "TN")).out()}
    return {"variants": variants}
