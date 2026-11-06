# Depot 5.0

Prototyp informačného systému (WMS) pre prekládkové depo kuriérskej spoločnosti v Budimíri pri Košiciach
s hubom v Bratislave. Školský tímový projekt na predmet AISPU. Proces depa je reálny, všetky dáta sú simulované.
V kóde sa projekt volá `depotrack`.

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
| http://localhost:8000/shadow?depot=BUD | dispečer, ochranka, admin | Digitálny tieň: 3D hala naživo s plávajúcimi panelmi, brány so senzormi, panely zariadení a kamiónov, hľadanie balíka, scenár „čo ak“ a akcie (dispečer) |
| http://localhost:8000/board?key=tabula-demo-2026 | verejné (kľúč `BOARD_KEY`) | Tabuľa príchodov a odchodov |
| http://localhost:8000/courier | kuriér (dispečer len náhľad), admin | Moje zastávky, „Doručené“ / „Nezastihnutý“ (mobil) |
| http://localhost:8000/track/&lt;token&gt; | verejné (odkaz zo SMS) | Sledovanie zásielky pre zákazníka (mobil) |
| http://localhost:8000/admin | admin | Používatelia, smery, zariadenia, simulácia, simulované SMS |
| http://localhost:8000/system | všetci | Stav systému a živý WebSocket |

Téma (Oranžová / Modrá) sa prepína v hornej lište.

Mapa Flotily: `/fleet?view=BUD` otvorí priblížené depo Budimír s 3D halou, `/fleet?plate=KE-102LH` vybrané vozidlo.

Sledovanie zásielky: kuriéri nakladajú ráno od 7:00 (v admine *Simulácia → skok na 06:00*). Každý balík naskenovaný do dodávky „pošle“ zákazníkovi SMS s odkazom `/track/<token>`. Odkazy sú v *Administrácia → Notifikácie* (tlačidlo „Otvoriť“).
Platný odkaz zvládne 60 požiadaviek za minútu (asi 5 otvorených okien), neplatné odkazy sú obmedzené na 10 za minútu z jednej IP (ADR-042). Za reverznou proxy nastav `FORWARDED_ALLOW_IPS`.

Digitálny tieň: `/shadow?depot=BUD&door=LD-02` otvorí panel kamióna, `&device=DOCK-SCN-02` panel skenera, `&fps=1` ukáže fps scény. Demo za 2 minúty je v [docs/fazy/faza-5-digitalny-tien.md](docs/fazy/faza-5-digitalny-tien.md), tieň v2 (layout, brány so senzormi, GLTF modely, hub Ivanka) v [docs/fazy/faza-5c-tien-v2.md](docs/fazy/faza-5c-tien-v2.md). `/shadow?depot=BAH` je hub v Ivanke pri Dunaji.

**Digitálny tieň, nie dvojča:** 3D pohľad automaticky zrkadlí realitu (skeny, vozidlá, zariadenia), ale do fyzického sveta zasahuje len cez rozhodnutia človeka v bežných obrazovkách WMS. Rozdiel model / tieň / dvojča vysvetľuje ADR-045.

## Mapy a geodáta

- Mapový podklad: [OpenFreeMap](https://openfreemap.org) (štýl Positron, © OpenMapTiles), dáta **© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)**. Podklad potrebuje v prehliadači internet.
- Cestná sieť a adresy pre simuláciu sú odvodené z OpenStreetMap (ODbL 1.0) a sú uložené v repozitári. Postup výroby je v [tools/osm/README.md](tools/osm/README.md). Za behu systém nič zo siete nesťahuje.
- 3D modely v digitálnom tieni (dodávka, autá, krabice): [Kenney](https://kenney.nl) Car Kit 3.1 a Factory Kit 3.0, licencia CC0 ([frontend/public/models/LICENSE.txt](frontend/public/models/LICENSE.txt)).
- Depo: **Budimír** (BUD), hub: **Ivanka pri Dunaji** (BAH, „hub Bratislava“, poloha z OSM, ADR-051).

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
| skok na ľubovoľný čas, bez dát (preskočí) | `POST /sim/clock/jump {"to": "18:30"}` |
| skok s dátami (rýchlo dosimuluje úsek, ADR-053) | `POST /sim/clock/jump {"to": "18:30", "mode": "replay"}` |
| krok o N minút s dátami (+5 / +15 / +60) | `POST /sim/clock/step {"minutes": 15}` |
| čistý reset dňa (seed z .env, bez údržby, presunov a alarmov dňa) | `POST /sim/reset` |
| situácie (zoznam, načítanie: čistý reset + pretočenie do času, ADR-054) | `GET /sim/situations`, `POST /sim/situations/evening-peak` |
| zmena seedu (deň znova od 15:00) | `PUT /sim/seed {"seed": 7}` |
| deň znova od 15:00 | `POST /sim/restart-day` |
| prehľad scenára (meškania, porucha) | `GET /sim/scenario` |
| vypnúť / zapnúť / opraviť zariadenie | `PUT /sim/devices/DOCK-SCN-05 {"enabled": false}`, `{"repair": true}` |

**Situácie na demo:** `evening-peak` (18:30), `night-cascade` (02:10), `calm-night` (23:30, bez kaskády v pláne), `morning-departures` (05:45), `couriers-morning` (07:20), `scanner-ld05` (20:30), `off-wave` (10:00). Načítajú sa v *Administrácia → Simulácia → Situácie* alebo odkazom pre admina, napr. http://localhost:8000/shadow?depot=BUD&situation=evening-peak. Rovnaká situácia dá vždy rovnaké čísla.

Ovládanie simulácie je len pre admina. **V ostrom režime nastav `SIM_CONTROLS_ENABLED=false`**: všetky ovládacie endpointy vrátia 403 a admin UI ich skryje. Scenár „čo ak“ funguje ďalej.

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
- [x] Fáza 3: design systém (témy Oranžová / Modrá) + jadro WMS (dispečing, nakládka, flotila, tabuľa ETA, detail balíka, admin simulácie)
- [x] Fáza 3b: MapLibre mapa, 3D sklady, depo Budimír + hub Bratislava, offline routing po reálnych cestách
- [x] Fáza 4: zákazník a kuriér (trasy kuriérov po uliciach, sledovanie zásielky so súkromím, `/courier`, simulované SMS)
- [x] Pred Fázou 5: názov Depot 5.0, digitálny tieň (`/shadow`), nový rate limit sledovania
- [x] Fáza 5: digitálny tieň (React 19 + R3F scéna, panely, scenáre „čo ak“, akcie WMS zo scény, údržba skenerov)
- [x] Fáza 5c: digitálny tieň v2 (layout podľa referencie, scéna v2, brány so senzormi, GLTF modely Kenney, hub v Ivanke)
- [ ] Fáza 5d: simulácia a testovanie (ovládanie času, situácie, incidenty, oprava scenára „čo ak“, hygiena alarmov, e2e)
- [ ] Fáza 5b: UX review (všetky obrazovky, 3 šírky)
- [ ] Fáza 6: ML
- [ ] Fáza 7: dokončenie
