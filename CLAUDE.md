# DepoTrack – pamäť projektu pre coding agenta

WMS prototyp pre prekládkové depo SPS (Budimír pri Košiciach, hub Bratislava). Školský tímový projekt AISPU.
Proces depa je reálny, dáta sú simulované. Tento súbor si prečítaj na začiatku každej session.

## Zdroje pravdy (čítaj podľa potreby, neopakuj ich sem)
- Zadanie: `docs/PROMPT.md` (povinné podmienky §1, fázy §10, pravidlá §11)
- Doplnky schválené tímom: `docs/plan-doplnky.md`
- Rozhodnutia: `docs/decisions.md` (ADR-001 až …). Pred zmenou architektúry nájdi súvisiace ADR.
- Vysvetlenia hotových fáz: `docs/fazy/` · design systém: `docs/design/komponenty.md`
- Stav projektu: `git log --oneline` (každá fáza = jeden commit `feat: phase N - …`)

## Architektúra v skratke (presne 4 kontajnery, nič nepridávaj)
| Služba | Stack | Port |
| --- | --- | --- |
| `app` | Python 3.12, FastAPI, SQLAlchemy 2, Alembic. Servíruje aj frontend (React, Vite, TS, Tailwind 4) | 8000 |
| `telematics` | Node.js 22, TypeScript, Fastify, ws. Simulátor, sim. hodiny, ETA, WebSocket | 8080 |
| `db-wms` / `db-telemetry` | PostgreSQL 16 | 5433 / 5434 |

- `app` je zdroj pravdy pre balíky, jazdy a trasy. Telematika vykonáva a hlási (ADR-022, ADR-041).
- Frontend volá oba backendy: REST + session cookie do `app`, WebSocket s ticketom do telematiky (ADR-027).
- Simulátor je deterministický (`SIM_RANDOM_SEED`, ADR-023). Všetok čas je simulovaný čas z telematiky.

## Príkazy
| Čo | Príkaz |
| --- | --- |
| Spustiť všetko | `docker compose up --build` |
| Testy app (potrebujú DB, ADR-015) | `docker compose run --rm app pytest` |
| Lint / typy app | `docker compose run --rm app ruff check src tests` · `docker compose run --rm app mypy src` |
| Telematika | `cd telematics && npm run lint && npm run typecheck && npm test` |
| Frontend | `cd frontend && npm run lint && npm run typecheck` |
| Nová migrácia db-wms | Alembic v `app/alembic/versions/` (formát názvu `YYYYMMDD_<rev>_<popis>.py`) |
| Nová migrácia db-telemetry | nový očíslovaný `telematics/sql/NNN_*.sql` (ADR-012) |

## Pravidlá
- **Nikdy** nespúšťaj `docker compose down -v` ani nemaž volumes bez výslovného súhlasu (hook to blokuje).
- Žiadne tajomstvá v repozitári. Nové premenné pridaj do `.env.example` a povedz používateľovi, nech ich doplní do `.env`.
- Texty v UI po slovensky, kód, identifikátory, commity a chybové správy API po anglicky (ADR-019). Nové API v camelCase (ADR-036).
- Každý endpoint má `require_role(...)`. O prístupe rozhoduje backend, frontend len skrýva menu (ADR-017). Súkromné dáta filtruj na serveri.
- Typy všade (mypy strict, strict TS). Nové závislosti len s odôvodnením v ADR.
- Používaj komponenty z `frontend/src/components/ui`. Layout kontroluj pri 1280, 1440 a 390 px.
- Nejasnosť: zvoľ rozumný default a zapíš krátke ADR (kontext, rozhodnutie, dôsledok). Odchýlku od zadania povedz otvorene.
- **Terminológia:** 3D pohľad `/twin` nazývaj **digitálny tieň** (digital shadow), nie „digitálne dvojča“. Dvojča by muselo riadiť fyzickú stranu, tieň ju len zrkadlí (odporúčanie cvičiaceho). Route `/twin` a názvy v kóde môžu ostať.
- Pracuj po fázach. Na začiatku a konci fázy použi skill `/faza`. Po fáze sa zastav a počkaj na potvrdenie.

## Automatické kontroly (`.claude/`)
- Po každej úprave súboru hook spustí eslint (frontend, telematics) alebo ruff (app, ak je `ruff` nainštalovaný lokálne). Chybu oprav hneď.
- Pred ukončením odpovede hook spustí typecheck a testy telematiky pre balíky so zmenami. Kým neprejdú, nekonči.
- Subagent `reviewer` nezávisle skontroluje fázu voči zadaniu a ADR. Spusti ho pred commitom fázy.

## Lessons learned
Sem pridaj krátky riadok vždy, keď narazíš na chybu, ktorá by sa mohla zopakovať, alebo keď ťa používateľ opraví.
Formát: `- [oblasť] čo sa stalo → ako to robiť správne`. Keď sekcia narastie nad ~30 riadkov, zlúč podobné body.

- [docs] Názov „digitálne dvojča“ v zadaní je zastaraný → v UI a dokumentácii používaj „digitálny tieň“.
