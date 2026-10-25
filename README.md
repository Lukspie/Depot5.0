# DepoTrack

Prototyp informačného systému (WMS) pre prekládkové depo SPS (Slovak Parcel Service) v Košiciach.
Školský tímový projekt na predmet AISPU. Proces depa je reálny, všetky dáta sú simulované.

- Zadanie: [docs/PROMPT.md](docs/PROMPT.md)
- Rozhodnutia: [docs/decisions.md](docs/decisions.md)
- Vysvetlenia po fázach: [docs/fazy/](docs/fazy/)

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
- [ ] Fáza 2: telematika
- [ ] Fáza 3: jadro WMS
- [ ] Fáza 4: zákazník a kuriér
- [ ] Fáza 5: digitálne dvojča
- [ ] Fáza 6: ML
- [ ] Fáza 7: dokončenie
