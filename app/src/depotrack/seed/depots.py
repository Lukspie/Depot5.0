"""Layouts of the depots from OSM geometry and a few notes per depot (phase 7c, ADR-064).

`data/depots_osm.json` (tools/osm/extract_depots.py) has the outline of every hall and its site.
This module turns it into the layout the digital shadow and the map draw (`depots.layout`,
`doors`): metres in the frame of the hall, x along the long side, y across it ("south" when the
hall is not rotated), the frame turned by `hall.rotationDeg` clockwise from east (ADR-040) and
anchored at `origin` (the centre of the hall). Sides are given as compass directions and resolved
against the rotation, so the notes read like a description of the place ("ramps on the west").

What OSM does not have (ramps, gate, stands, parking) is an assumption until the team's satellite
pictures are checked; `source.assumed` lists it for every depot. The routing point of a depot
(`depots.lat/lon`) stays where it was for Budimír and Ivanka: the simulator computes the routes
from it and must stay deterministic.
"""

import hashlib
import json
import math
from dataclasses import dataclass
from functools import cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "depots_osm.json"
COMPASS = {"N": (0.0, -1.0), "S": (0.0, 1.0), "E": (1.0, 0.0), "W": (-1.0, 0.0)}  # east, south
STAND = (17.0, 4.0)  # semi-trailer stand: length, width (m)
VAN = (6.0, 2.8)


@dataclass(frozen=True)
class Spec:
    code: str
    name: str
    kind: str  # depot | hub
    height: float
    ramp_side: str
    ramps: tuple[str, ...]
    ramp_equipment: tuple[tuple[str, str], ...]  # (door drive, dock equipment) per ramp
    courier_side: str | None  # staging bays inside along this wall
    courier_bays: tuple[str, ...]
    reserved_end: tuple[str, float] | None  # e.g. offices at the south end
    gate: tuple[str, float]  # side of the site and position along the hall (-1 .. 1)
    gate_code: str | None
    stands: tuple[str, int]  # side of the yard for trailers, count
    vans: tuple[str, int]  # side of the yard for the courier vans, count
    belt: bool
    assumed: tuple[str, ...]
    # no plot of the depot in OSM: the yard is the hall plus these margins (compass -> metres)
    yard_margins: tuple[tuple[str, float], ...] = ()


# Budimír: ramps to the east (52-57 m of yard), courier bays along the west wall, the large south
# yard (122 m) holds the trailers and the vans. Codes and equipment as before (ADR-050).
BUD = Spec(
    code="BUD",
    name="Budimír",
    kind="depot",
    height=10,
    ramp_side="E",
    ramps=tuple(f"LD-{i:02d}" for i in range(1, 9)),
    ramp_equipment=(("electric", "dock_leveler"),) * 2
    + (("electric", "telescopic_conveyor"),) * 3
    + (("electric", "none"),) * 3,
    courier_side="W",
    courier_bays=tuple(f"SB-{i:02d}" for i in range(1, 9)),
    reserved_end=None,
    gate=("S", 0.0),
    gate_code="GATE-01",
    stands=("S", 8),
    vans=("S", 8),
    belt=True,
    assumed=("ramps side and count", "gate", "trailer stands", "van parking"),
)

# Ivanka pri Dunaji: 85 m of yard to the west, only 28 m to the east: the ramps face west.
BAH = Spec(
    code="BAH",
    name="Ivanka pri Dunaji",
    kind="hub",
    height=12,
    ramp_side="W",
    ramps=tuple(f"BA-R{i:02d}" for i in range(1, 7)),
    ramp_equipment=(("electric", "dock_leveler"),) * 6,
    courier_side="E",
    courier_bays=(),
    reserved_end=None,
    gate=("W", 0.6),
    gate_code=None,
    stands=("W", 8),
    vans=("N", 6),
    belt=False,
    assumed=("ramps side and count", "gate", "trailer stands", "van parking"),
)

# Žilina (team): ramps on the west long side towards the SNP street, offices at the south end,
# trailers park on the east side. Counts of ramps and courier doors are an assumption.
ZIL = Spec(
    code="ZIL",
    name="Žilina",
    kind="depot",
    height=10,
    ramp_side="W",
    ramps=tuple(f"ZI-R{i:02d}" for i in range(1, 7)),
    ramp_equipment=(("electric", "dock_leveler"),) * 6,
    courier_side="W",
    courier_bays=tuple(f"ZI-SB{i:02d}" for i in range(1, 5)),
    reserved_end=("S", 20.0),
    gate=("W", -0.75),
    gate_code="ZI-GATE",
    stands=("E", 6),
    vans=("N", 4),
    belt=True,
    assumed=("ramp and courier door counts", "gate", "van parking"),
)

# Dunajská Streda (Malé Dvorníky 610): a small depot fed from Ivanka. OSM has the hall (way
# 388660269, 30 x 15.6 m) but no plot of its own, only a shared industrial zone of 512 x 429 m:
# the yard is a rectangle around the hall until the team's satellite picture is checked.
DS = Spec(
    code="DS",
    name="Dunajská Streda",
    kind="depot",
    height=7,
    ramp_side="W",
    ramps=("DS-R01", "DS-R02"),
    ramp_equipment=(("electric", "dock_leveler"),) * 2,
    courier_side="E",
    courier_bays=("DS-SB01", "DS-SB02", "DS-SB03"),
    reserved_end=None,
    gate=("W", 0.0),
    gate_code="DS-GATE",
    stands=("S", 2),
    vans=("E", 3),
    belt=False,
    assumed=(
        "yard outline",
        "ramps side and count",
        "courier doors",
        "gate",
        "trailer stands",
        "van parking",
    ),
    yard_margins=(("W", 32.0), ("E", 18.0), ("N", 8.0), ("S", 26.0)),
)

SPECS = (BUD, BAH, ZIL, DS)


@dataclass(frozen=True)
class DoorPlace:
    code: str
    kind: str  # loading_dock | staging_bay | yard_gate
    x: float
    y: float
    door_drive: str
    dock_equipment: str


@dataclass(frozen=True)
class Built:
    code: str
    name: str
    kind: str
    origin: tuple[float, float]  # centre of the hall: lat, lon
    layout: dict[str, object]
    doors: tuple[DoorPlace, ...]


def _r(v: float) -> float:
    return round(v, 1)


class Frame:
    def __init__(self, origin: tuple[float, float], rotation_deg: float) -> None:
        self.origin = origin
        t = math.radians(rotation_deg)
        self.c, self.s = math.cos(t), math.sin(t)
        self.kx = 111_320 * math.cos(math.radians(origin[0]))

    def local(self, lat: float, lon: float) -> tuple[float, float]:
        e, s = (lon - self.origin[1]) * self.kx, -(lat - self.origin[0]) * 110_574
        return (e * self.c + s * self.s, -e * self.s + s * self.c)

    def side(self, compass: str) -> tuple[str, int]:
        """("x" | "y", +1 | -1): the side of the hall that faces this compass direction."""
        sides = {("x", 1): (self.c, self.s), ("x", -1): (-self.c, -self.s)}
        sides |= {("y", 1): (-self.s, self.c), ("y", -1): (self.s, -self.c)}
        want = COMPASS[compass]
        return max(sides, key=lambda k: sides[k][0] * want[0] + sides[k][1] * want[1])


def inside(p: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    x, y = p
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def _ray(
    ring: list[tuple[float, float]], start: tuple[float, float], d: tuple[float, float]
) -> float:
    """Distance from `start` along `d` to the site boundary (inf when it never leaves)."""
    best = math.inf
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        den = d[0] * (y2 - y1) - d[1] * (x2 - x1)
        if abs(den) < 1e-9:
            continue
        t = ((x1 - start[0]) * (y2 - y1) - (y1 - start[1]) * (x2 - x1)) / den
        u = ((x1 - start[0]) * d[1] - (y1 - start[1]) * d[0]) / den
        if t > 0 and 0 <= u <= 1:
            best = min(best, t)
    return best


def _pt(axis: str, sign: int, along: float, out: float) -> tuple[float, float]:
    """A point `out` metres beyond the hall's side (axis, sign) at `along` along that side."""
    return (sign * out, along) if axis == "x" else (along, sign * out)


def _slots(
    axis: str,
    sign: int,
    wall: float,
    span: float,
    count: int,
    size: tuple[float, float],
    site: list[tuple[float, float]],
    gap: float,
) -> list[dict[str, float]]:
    """`count` parking slots in rows perpendicular to the wall (axis, sign), inside the site."""
    length, width = size
    pitch = width + 0.6
    heading = (0.0 if axis == "x" else 90.0) if sign > 0 else (180.0 if axis == "x" else 270.0)
    out: list[dict[str, float]] = []
    row = 0
    while len(out) < count and row < 6:
        dist = wall + gap + length / 2 + row * (length + 7)
        n = max(1, int(span // pitch))
        # from the middle of the row outwards, so a short row is centred on the hall
        alongs = sorted((-span / 2 + pitch / 2 + i * pitch for i in range(n)), key=abs)
        fits: list[tuple[float, float, float]] = []
        for along in alongs:
            x, y = _pt(axis, sign, along, dist)
            hx, hy = (length / 2, width / 2) if axis == "x" else (width / 2, length / 2)
            corners = [(x - hx, y - hy), (x + hx, y - hy), (x + hx, y + hy), (x - hx, y + hy)]
            if all(inside(c, site) for c in corners):
                fits.append((along, x, y))
                if len(out) + len(fits) == count:
                    break
        out += [{"x": _r(x), "y": _r(y), "heading": heading} for _, x, y in sorted(fits)]
        row += 1
    return out


def build(spec: Spec, osm: dict[str, object]) -> Built:
    hall = osm["hall"]
    assert isinstance(hall, dict)
    rotation = (180 - float(hall["angleCcw"])) % 180
    origin = (float(hall["lat"]), float(hall["lon"]))
    frame = Frame(origin, rotation)
    w, d = float(hall["width"]), float(hall["depth"])
    half = {"x": w / 2, "y": d / 2}
    site_ring = osm.get("siteRing")
    if site_ring:
        assert isinstance(site_ring, list)
        site = [frame.local(float(p[0]), float(p[1])) for p in site_ring]
    else:
        m = {frame.side(c): v for c, v in spec.yard_margins}
        x0, x1 = -w / 2 - m.get(("x", -1), 5.0), w / 2 + m.get(("x", 1), 5.0)
        y0, y1 = -d / 2 - m.get(("y", -1), 5.0), d / 2 + m.get(("y", 1), 5.0)
        site = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

    # usable length of a long wall: minus offices at one end
    lo, hi = -w / 2 + 4, w / 2 - 4
    if spec.reserved_end:
        axis, sign = frame.side(spec.reserved_end[0])
        assert axis == "x", "offices are expected at an end of the hall"
        if sign > 0:
            hi = w / 2 - spec.reserved_end[1]
        else:
            lo = -w / 2 + spec.reserved_end[1]

    doors: list[DoorPlace] = []
    ramp_axis, ramp_sign = frame.side(spec.ramp_side)
    assert ramp_axis == "y", "ramps are expected on a long side"
    same_wall = spec.courier_side == spec.ramp_side
    n_wall = len(spec.ramps) + (len(spec.courier_bays) if same_wall else 0)
    pitch = (hi - lo) / max(1, n_wall)
    xs = [lo + pitch / 2 + i * pitch for i in range(n_wall)]
    # on a shared wall the courier doors take the end away from the offices, then the ramps
    courier_xs = xs[: len(spec.courier_bays)] if same_wall else []
    ramp_xs = xs[len(courier_xs) :]
    for code, x, (drive, eq) in zip(spec.ramps, ramp_xs, spec.ramp_equipment, strict=True):
        doors.append(DoorPlace(code, "loading_dock", _r(x), _r(ramp_sign * d / 2), drive, eq))
    van_loading: list[dict[str, object]] = []
    if spec.courier_bays:
        assert spec.courier_side is not None
        _c_axis, c_sign = frame.side(spec.courier_side)
        if not same_wall:
            cp = (hi - lo) / len(spec.courier_bays)
            courier_xs = [lo + cp / 2 + i * cp for i in range(len(spec.courier_bays))]
        for code, x in zip(spec.courier_bays, courier_xs, strict=True):
            # the bay is the floor area inside the courier door, the van loads just outside it
            doors.append(
                DoorPlace(code, "staging_bay", _r(x), _r(c_sign * (d / 2 - 4)), "manual", "none")
            )
            van_loading.append(
                {
                    "bay": code,
                    "x": _r(x),
                    "y": _r(c_sign * (d / 2 + 4)),
                    "heading": 90.0 if c_sign > 0 else 270.0,
                }
            )

    # gate: where a line from the hall side meets the site boundary
    g_axis, g_sign = frame.side(spec.gate[0])
    along = spec.gate[1] * (w / 2 if g_axis == "y" else d / 2)
    start = _pt(g_axis, g_sign, along, half[g_axis])
    direction = (g_sign, 0.0) if g_axis == "x" else (0.0, float(g_sign))
    reach = _ray(site, start, direction)
    gate = _pt(g_axis, g_sign, along, half[g_axis] + (reach - 2 if math.isfinite(reach) else 20))
    gate = (_r(gate[0]), _r(gate[1]))
    if spec.gate_code:
        doors.append(DoorPlace(spec.gate_code, "yard_gate", gate[0], gate[1], "electric", "none"))

    s_axis, s_sign = frame.side(spec.stands[0])
    stands = _slots(
        s_axis, s_sign, half[s_axis], w - 8 if s_axis == "y" else d, spec.stands[1], STAND, site,
        gap=18 if (s_axis, s_sign) == (ramp_axis, ramp_sign) else 4,
    )  # fmt: skip
    v_axis, v_sign = frame.side(spec.vans[0])
    van_span = (w - 8 if v_axis == "y" else d) / (2 if (v_axis, v_sign) == (s_axis, s_sign) else 1)
    vans = _slots(v_axis, v_sign, half[v_axis], van_span, spec.vans[1], VAN, site, gap=4)
    if (v_axis, v_sign) == (s_axis, s_sign):
        # one yard for both: the vans take the other half of it
        shift = van_span / 2
        stands = [
            s | ({"y": _r(s["y"] + shift)} if s_axis == "x" else {"x": _r(s["x"] + shift)})
            for s in stands
        ]
        vans = [
            v | ({"y": _r(v["y"] - shift)} if v_axis == "x" else {"x": _r(v["x"] - shift)})
            for v in vans
        ]

    # driving lane: a ring around the hall with room in front of the ramps, joined to the gate
    def room(axis: str, sign: int, want: float) -> float:
        free = _ray(
            site,
            _pt(axis, sign, 0.0, half[axis]),
            (sign, 0.0) if axis == "x" else (0.0, float(sign)),
        )
        return min(want, free - 3) if math.isfinite(free) else want

    oy_ramp = room("y", ramp_sign, 22)
    oy_back = room("y", -ramp_sign, 6)
    ox_pos, ox_neg = room("x", 1, 6), room("x", -1, 6)
    y_ramp = ramp_sign * (d / 2 + oy_ramp)
    y_back = -ramp_sign * (d / 2 + oy_back)
    ring = [
        (-w / 2 - ox_neg, y_ramp),
        (w / 2 + ox_pos, y_ramp),
        (w / 2 + ox_pos, y_back),
        (-w / 2 - ox_neg, y_back),
    ]
    ring = [(_r(x), _r(y)) for x, y in ring]
    nearest = min(ring, key=lambda p: math.dist(p, gate))
    lanes = [[list(p) for p in [*ring, ring[0]]], [list(gate), list(nearest)]]

    layout: dict[str, object] = {
        "origin": [round(origin[0], 6), round(origin[1], 6)],
        "hall": {"width": w, "depth": d, "height": spec.height, "rotationDeg": round(rotation, 1)},
        "site": [[_r(x), _r(y)] for x, y in site],
        "yardGate": list(gate),
        "yard": {
            "gate": list(gate),
            "truckStands": [
                {"code": f"{spec.code}-T{i + 1:02d}"} | s for i, s in enumerate(stands)
            ],
            "vanParking": [{"code": f"{spec.code}-P{i + 1:02d}"} | v for i, v in enumerate(vans)],
            "vanLoading": van_loading,
            "lanes": lanes,
        },
        "source": {
            "hallWay": osm["hallWay"],
            "siteWay": osm.get("siteWay"),
            "assumed": list(spec.assumed),
        },
    }
    if spec.belt:
        by = _r(ramp_sign * d / 4)
        layout["belt"] = [[_r(-w / 2 + 8), by], [_r(w / 2 - 8), by]]
        layout["lineScanner"] = [0.0, by]
        layout["sensors"] = [[_r(-w / 3), by], [0.0, by], [_r(w / 3), by]]
    return Built(spec.code, spec.name, spec.kind, origin, layout, tuple(doors))


@cache
def built_depots() -> dict[str, Built]:
    osm = {d["code"]: d for d in json.loads(DATA.read_text(encoding="utf-8"))}
    return {s.code: build(s, osm[s.code]) for s in SPECS}


def data_version() -> str:
    """Changes when the geometry or the notes change: the seed step re-applies the layouts."""
    blob = DATA.read_bytes() + repr(SPECS).encode()
    return hashlib.sha256(blob).hexdigest()[:12]
