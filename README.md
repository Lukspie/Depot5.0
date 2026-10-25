# DepoTrack

Prototyp informačného systému (WMS) pre prekládkové depo SPS (Slovak Parcel Service) v Košiciach.
Školský tímový projekt na predmet AISPU. Proces depa je reálny, všetky dáta sú simulované.

- Zadanie: [docs/PROMPT.md](docs/PROMPT.md)
- Rozhodnutia: [docs/decisions.md](docs/decisions.md)
- Vysvetlenia po fázach: [docs/fazy/](docs/fazy/)
- Doplnky k plánu: [docs/plan-doplnky.md](docs/plan-doplnky.md), vizuálny cieľ: [docs/design/](docs/design/)

## Architektúra (4 kontajnery)

| Služba | Technológia | Port |
| --- | --- | --- |
| `app` | Python 3.12, FastAPI. Hlavný backend, servíruje aj frontend (React) | 8000 |
| `telematics` | Node.js 22 LTS, TypeScript, Fastify. Simulátor a telemetria | 8080 |
| `db-wms` | PostgreSQL 16, obchodné dáta | 127.0.0.1:5433 |
| `db-telemetry` | PostgreSQL 16, telemetria | 127.0.0.1:5434 |

## Spustenie

Potrebuješ Docker Desktop (alebo Docker Engine s Compose v2).

```bash
cp .env.example .env          # pri prvom spustení; hodnoty change-me zmeň
docker compose up --build
```

| Adresa | Čo |
| --- | --- |
| http://localhost:8000 | aplikácia |
| http://localhost:8000/api/docs | OpenAPI hlavného backendu |
| http://localhost:8080/docs | Swagger telematiky |

Databázy v DBeaveri: host `localhost`, port `5433` (wms) / `5434` (telemetry), meno a heslo podľa `.env`.

Zastavenie: `docker compose down`. Zmazanie dát: `docker compose down -v`.

## Prihlasovacie údaje

Používatelia vzniknú pri prvom štarte (seed). Heslá sa berú z `.env`, v kóde nie sú.
Predvolené hodnoty v `.env.example` slúžia **len na vývoj a demo**.

| Používateľ | Rola | Heslo (premenná v `.env`) | Predvolené v `.env.example` |
| --- | --- | --- | --- |
| `admin` | Administrátor | `SEED_ADMIN_PASSWORD` | `admin-demo-2026` |
| `dispecer` | Dispečer | `SEED_DISPATCHER_PASSWORD` | `dispecer-demo-2026` |
| `operator` | Operátor nakládky | `SEED_OPERATOR_PASSWORD` | `operator-demo-2026` |
| `ochranka` | Ochranka | `SEED_SECURITY_PASSWORD` | `ochranka-demo-2026` |
| `kurier01` … `kurier08` | Kuriér | `SEED_COURIER_PASSWORD` | `kurier-demo-2026` |

Heslá sa nastavujú len pri prvom seede. Neskôr ich mení admin v aplikácii, alebo treba spustiť
`docker compose down -v`, ktoré zmaže všetky dáta.

## Obrazovky

| Adresa | Kto | Čo |
| --- | --- | --- |
| http://localhost:8000/ | dispečer, admin | Dispečing |
| http://localhost:8000/loading | operátor, admin | Nakládka pri bránach |
| http://localhost:8000/fleet | dispečer, admin | Flotila na mape |
| http://localhost:8000/board?key=tabula-demo-2026 | verejné (kľúč `BOARD_KEY`) | Tabuľa príchodov a odchodov |
| http://localhost:8000/admin | admin | Používatelia, smery, zariadenia, simulácia |
| http://localhost:8000/system | všetci | Stav systému a živý WebSocket |

Téma (SPS oranžová / Modrá) sa prepína v hornej lište.

Mapa Flotily: `/fleet?view=BUD` otvorí priblížené depo Budimír s 3D halou, `/fleet?plate=KE-102LH` vybrané vozidlo.

## Mapy a geodáta

- Mapový podklad: [OpenFreeMap](https://openfreemap.org) (štýl Positron, © OpenMapTiles), dáta **© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)**. Podklad potrebuje v prehliadači internet.
- Cestná sieť a adresy pre simuláciu sú odvodené z OpenStreetMap (ODbL 1.0) a sú uložené v repozitári. Postup výroby je v [tools/osm/README.md](tools/osm/README.md). Za behu systém nič zo siete nesťahuje.
- Depo: **Budimír** (BUD), hub: **Bratislava** (BAH).

## Simulácia

Telematika simuluje deň depa so zrýchleným časom (predvolene 60×, štart 15:00). Pri rovnakom
`SIM_RANDOM_SEED` sa deň odohrá rovnako. V predvolenom scenári je vždy porucha nočného kamióna,
ktorá spustí kaskádové varovanie, a degradácia skenera `DOCK-SCN-02`.

Ovládanie (admin): Swagger na http://localhost:8080/docs, autorizácia `Bearer <ticket>`. Ticket
vydá `POST /api/auth/ws-ticket` po prihlásení a platí 60 s.

| Akcia | Volanie |
| --- | --- |
| čas, rýchlosť, seed | `GET /sim/clock` (verejné) |
| pauza / pokračovanie | `POST /sim/clock/pause`, `POST /sim/clock/resume` |
| rýchlosť | `PUT /sim/clock/speed {"speed": 600}` |
| skok (večerná vlna, nočné kamióny, ranné odchody) | `POST /sim/clock/jump {"to": "15:30" \| "01:00" \| "06:00"}` |
| zmena seedu (deň znova od 15:00) | `PUT /sim/seed {"seed": 7}` |
| deň znova od 15:00 | `POST /sim/restart-day` |
| prehľad scenára (meškania, porucha) | `GET /sim/scenario` |
| vypnúť / zapnúť / opraviť zariadenie | `PUT /sim/devices/DOCK-SCN-05 {"enabled": false}`, `{"repair": true}` |

Príklad s curl je v [docs/fazy/faza-2-telematika.md](docs/fazy/faza-2-telematika.md#ako-to-overiť).

História pre tréning ML (6 mesiacov jázd a metrík skenerov do `ml/data/`, mimo git):
```bash
cd telematics && npm ci && npm run gen:history -- --days 180 --out ../ml/data
```

## Vývoj a testy

```bash
# app: testy, lint, typy (v kontajneri, potrebuje db-wms;
# testy si vytvoria vlastnú databázu depotrack_test, dáta aplikácie nemenia)
docker compose run --rm app pytest
docker compose run --rm --no-deps app sh -c "ruff check . && ruff format --check . && mypy src"

# telematics
cd telematics && npm ci && npm run typecheck && npm run lint && npm test

# frontend (dev server s hot reloadom, /api sa proxuje na localhost:8000)
cd frontend && npm ci && npm run dev
```

## Stav fáz

- [x] Fáza 0: kostra (4 kontajnery, healthchecky, hello endpointy, frontend z `app`)
- [x] Fáza 1: dáta a auth (schémy, migrácie, seed, sessions, RBAC, správa používateľov)
- [x] Fáza 2: telematika (hodiny, deterministický simulátor, WebSocket s ticketom, REST medzi backendmi, kaskáda)
- [x] Fáza 3: design systém (témy SPS / Modrá) + jadro WMS (dispečing, nakládka, flotila, tabuľa ETA, detail balíka, admin simulácie)
- [x] Fáza 3b: MapLibre mapa, 3D sklady, depo Budimír + hub Bratislava, offline routing po reálnych cestách
- [ ] Fáza 4: zákazník a kuriér
- [ ] Fáza 5: digitálne dvojča
- [ ] Fáza 5b: UX review (všetky obrazovky, 3 šírky)
- [ ] Fáza 6: ML
- [ ] Fáza 7: dokončenie
