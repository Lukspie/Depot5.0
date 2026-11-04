"""Static reference data of the Košice depot (directions, doors, vehicles, users).

All people and companies are fictional. Town coordinates are real (town centres).
"""

from dataclasses import dataclass, field
from datetime import time

from depotrack.models.enums import DirectionType, UserRole, VehicleKind

# Budimír industrial zone, north-east of Košice (approximate, to be refined; ADR-039)
DEPOT_LAT, DEPOT_LON = 48.79256, 21.30710
KOSICE_LAT, KOSICE_LON = 48.7164, 21.2611
KOSICE_RADIUS_KM = 5.5


@dataclass(frozen=True)
class DirectionDef:
    code: str
    name: str
    type: DirectionType
    cutoff: time | None
    departure: time | None
    depends_on: list[str] = field(default_factory=list)
    # destination area for generated recipient addresses (not used for local)
    lat: float = KOSICE_LAT
    lon: float = KOSICE_LON
    postcode: str = "040 01"
    town: str = "Košice"
    share: float = 1.0  # relative parcel volume within its type


LINEHAUL = [
    DirectionDef(
        "BB",
        "Banská Bystrica",
        DirectionType.LINEHAUL,
        time(20, 0),
        time(20, 30),
        lat=48.7363,
        lon=19.1462,
        postcode="974 01",
        town="Banská Bystrica",
        share=0.9,
    ),
    DirectionDef(
        "BA",
        "Bratislava",
        DirectionType.LINEHAUL,
        time(21, 0),
        time(21, 30),
        lat=48.1486,
        lon=17.1077,
        postcode="811 01",
        town="Bratislava",
        share=1.4,
    ),
    DirectionDef(
        "ZA",
        "Žilina",
        DirectionType.LINEHAUL,
        time(20, 30),
        time(21, 0),
        lat=49.2232,
        lon=18.7394,
        postcode="010 01",
        town="Žilina",
        share=0.9,
    ),
]

# ADR-008: list to be verified with a domain expert
TRANSIT = [
    DirectionDef(
        "MI",
        "Michalovce",
        DirectionType.TRANSIT,
        time(5, 30),
        time(6, 0),
        ["BA", "ZA", "BB"],
        48.7543,
        21.9195,
        "071 01",
        "Michalovce",
        1.3,
    ),
    DirectionDef(
        "TV",
        "Trebišov",
        DirectionType.TRANSIT,
        time(5, 45),
        time(6, 15),
        ["BA", "BB"],
        48.6286,
        21.7178,
        "075 01",
        "Trebišov",
        1.0,
    ),
    DirectionDef(
        "HE",
        "Humenné",
        DirectionType.TRANSIT,
        time(5, 30),
        time(6, 0),
        ["BA", "ZA"],
        48.9371,
        21.9063,
        "066 01",
        "Humenné",
        1.0,
    ),
    DirectionDef(
        "SL",
        "Stará Ľubovňa",
        DirectionType.TRANSIT,
        time(5, 15),
        time(5, 45),
        ["ZA", "BB"],
        49.2986,
        20.6866,
        "064 01",
        "Stará Ľubovňa",
        0.8,
    ),
    DirectionDef(
        "SE",
        "Senica",
        DirectionType.TRANSIT,
        time(6, 0),
        time(6, 30),
        ["BA"],
        48.6794,
        17.3667,
        "905 01",
        "Senica",
        0.6,
    ),
]

# Regional directions too far for a same-day round trip get two trucks that alternate by
# operating day: one leaves Košice in the morning while the other drives back (ADR-031).
TRUCK_ROTATION: dict[str, int] = {"SE": 2}

# Courier districts: 8 compass sectors around the Košice centre, clockwise from north.
_SECTORS = [
    "sever",
    "severovýchod",
    "východ",
    "juhovýchod",
    "juh",
    "juhozápad",
    "západ",
    "severozápad",
]
LOCAL = [
    DirectionDef(
        f"KE-{i + 1:02d}", f"Košice – {name}", DirectionType.LOCAL, time(7, 0), time(7, 30)
    )
    for i, name in enumerate(_SECTORS)
]

DIRECTIONS = LINEHAUL + TRANSIT + LOCAL


@dataclass(frozen=True)
class DoorDef:
    code: str
    kind: str
    direction_code: str | None
    x: float
    y: float


# Hall is 80 m x 40 m centred at (0, 0); loading docks on the north wall (y = -20),
# courier staging bays along the south wall, yard gate to the east.
DOORS = (
    [
        DoorDef(f"LD-{i + 1:02d}", "loading_dock", d.code, -35.0 + i * 10.0, -20.0)
        for i, d in enumerate(LINEHAUL + TRANSIT)
    ]
    + [
        DoorDef(f"SB-{i + 1:02d}", "staging_bay", d.code, -35.0 + i * 10.0, 16.0)
        for i, d in enumerate(LOCAL)
    ]
    + [DoorDef("GATE-01", "yard_gate", None, 60.0, -32.0)]
)


# The Bratislava hub of the carrier in Ivanka pri Dunaji (ADR-051): OSM way 52070792,
# "Slovak Parcel Service | UPS", 167 x 54 m, long side ~94° from east (counter-clockwise).
# rotationDeg is clockwise from east (map layer, ADR-040). The side and number of the ramps are an
# assumption (OSM has no ramps): 6 on one long side. The depot row itself comes from the migrations
# (e652f4dbafdb, moved by e7f1c3a9b5d2); the seed creates the ramps from HUB_RAMPS and test_depots
# checks the database against these constants.
HUB_NAME = "Ivanka pri Dunaji"
HUB_LAT, HUB_LON = 48.19404, 17.22834
HUB_LAYOUT: dict[str, object] = {
    "hall": {"width": 167, "depth": 54, "height": 12, "rotationDeg": 86.1},
    "yardGate": [96, -44],
}
HUB_RAMPS: list[tuple[float, float]] = [(-55.0 + i * 22.0, -27.0) for i in range(6)]

# Temporary door equipment until the team delivers the real Budimír layout (plan-doplnky 5c):
# 2 main truck doors with a dock leveler, 3 on the platform with a telescopic conveyor, 3 plain
# electric doors; courier doors are manual (rope). Codes not listed: electric, no equipment.
DOOR_EQUIPMENT: dict[str, tuple[str, str]] = {
    **{f"LD-0{i}": ("electric", "dock_leveler") for i in (1, 2)},
    **{f"LD-0{i}": ("electric", "telescopic_conveyor") for i in (3, 4, 5)},
    **{f"LD-0{i}": ("electric", "none") for i in (6, 7, 8)},
    **{f"SB-0{i}": ("manual", "none") for i in range(1, 9)},
    **{f"BA-R0{i}": ("electric", "dock_leveler") for i in range(1, 7)},
}


@dataclass(frozen=True)
class VehicleDef:
    plate: str
    kind: VehicleKind
    capacity_kg: int
    capacity_parcels: int


VEHICLES = (
    # 6 linehaul semi-trailers
    [
        VehicleDef(p, VehicleKind.TRUCK, 24000, 3000)
        for p in ["KE-101LH", "KE-102LH", "KE-103LH", "KE-104LH", "KE-105LH", "KE-106LH"]
    ]
    # 6 regional (transit) box trucks
    + [
        VehicleDef(p, VehicleKind.TRUCK, 7000, 1200)
        for p in ["KE-201TR", "KE-202TR", "KE-203TR", "KE-204TR", "KE-205TR", "KE-206TR"]
    ]
    # 8 courier vans
    + [VehicleDef(f"KE-3{i:02d}KR", VehicleKind.VAN, 1100, 160) for i in range(1, 9)]
)


@dataclass(frozen=True)
class UserDef:
    username: str
    full_name: str
    role: UserRole


USERS = [
    UserDef("admin", "Martin Kováč", UserRole.ADMIN),
    UserDef("dispecer", "Jana Horváthová", UserRole.DISPATCHER),
    UserDef("operator", "Peter Varga", UserRole.OPERATOR),
    UserDef("ochranka", "Milan Tóth", UserRole.SECURITY),
] + [
    UserDef(f"kurier{i:02d}", name, UserRole.COURIER)
    for i, name in enumerate(
        [
            "Tomáš Baláž",
            "Lucia Nagyová",
            "Marek Šimko",
            "Ivana Kollárová",
            "Róbert Lukáč",
            "Zuzana Molnárová",
            "Patrik Hudák",
            "Eva Sabová",
        ],
        start=1,
    )
]

FIRST_NAMES = [
    "Ján",
    "Peter",
    "Martin",
    "Tomáš",
    "Michal",
    "Lukáš",
    "Jozef",
    "Marek",
    "Andrej",
    "Juraj",
    "Mária",
    "Anna",
    "Zuzana",
    "Katarína",
    "Lucia",
    "Jana",
    "Eva",
    "Monika",
    "Veronika",
    "Simona",
]
LAST_NAMES_M = [
    "Horváth",
    "Kováč",
    "Varga",
    "Tóth",
    "Nagy",
    "Baláž",
    "Szabó",
    "Molnár",
    "Lukáč",
    "Hudák",
    "Kollár",
    "Novák",
    "Kráľ",
    "Oravec",
    "Gajdoš",
    "Sabol",
    "Polák",
    "Šimko",
    "Fedor",
    "Čech",
]
FEMALE_FIRST = set(FIRST_NAMES[10:])

KOSICE_STREETS = [
    "Hlavná",
    "Mlynská",
    "Štúrova",
    "Moyzesova",
    "Komenského",
    "Popradská",
    "Trieda SNP",
    "Hroncova",
    "Watsonova",
    "Toryská",
    "Budapeštianska",
    "Jantárová",
    "Južná trieda",
    "Rastislavova",
    "Masarykova",
    "Kuzmányho",
    "Dénešova",
    "Klimkovičova",
    "Moldavská cesta",
    "Ďumbierska",
    "Postupimská",
    "Bauerova",
    "Exnárova",
    "Košická",
    "Námestie osloboditeľov",
]
TOWN_STREETS = [
    "Hlavná",
    "Školská",
    "Záhradná",
    "Mierová",
    "Nová",
    "Partizánska",
    "Družstevná",
    "Slovenská",
    "Štúrova",
    "Sládkovičova",
    "Hviezdoslavova",
    "Krátka",
]
SENDERS = [
    "ElektroBox s.r.o.",
    "Módny dom Lina s.r.o.",
    "KnihyPlus a.s.",
    "Zdravá lekáreň s.r.o.",
    "Hobby Market s.r.o.",
    "TechStore SK s.r.o.",
    "Kozmetika Iris s.r.o.",
    "Športmix a.s.",
    "Hračky Klbko s.r.o.",
    "AutoDiely Východ s.r.o.",
    "Kancel s.r.o.",
    "Domáce potreby Elis",
]
