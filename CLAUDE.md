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
| Testy app (potrebujú DB, ADR-015) | `docker compose run --rm app pytest`. Image má kód napevno: po zmene najprv `docker compose build app`, alebo namontuj zdrojáky (Lessons learned) |
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
- **Terminológia:** 3D pohľad nazývaj **digitálny tieň** (digital shadow), nikdy „digitálne dvojča / digital twin“. Dvojča by muselo priamo riadiť fyzické zariadenia, tieň ich len zrkadlí (požiadavka garanta). Route je `/shadow`, kód v `frontend/src/shadow`, stránka `ShadowPage` (ADR-045). Dvojča spomínaj len ako „ďalší rozvoj“.
- **Názov:** projekt sa navonok volá **„Depot 5.0“** (v kóde môže ostať `depotrack`). V UI nepoužívaj názov SPS. Téma sa volá **„Oranžová“** (id `oranzova`). Depo je „Budimír“. Čiarové kódy nových dní majú prefix `DP` (ADR-044).
- **Simulátor za behu nevolá internet.** Determinizmus z Fázy 2 musí ostať. Nové náhodné rozhodnutia dostanú vlastný prúd `rngFor(seed, deň, …)`.
- **Git:** commituj len lokálne, remote zatiaľ nie je nastavený (nepushuj).
- **Test z čistého klonu bez volumes:**
  - naklonuj repo do dočasného priečinka a skopíruj `.env.example` → `.env`,
  - hlavný stack len zastav (`docker compose stop`), aby sa uvoľnili porty,
  - spusti `docker compose -p dtclean -f docker-compose.yml -f tmpfs.yml up -d --build`, kde `tmpfs.yml` (mimo repa) dá pre `db-wms` aj `db-telemetry` `volumes: !reset []` a `tmpfs: [/var/lib/postgresql/data]` a na najvyššej úrovni `volumes: !reset {}`,
  - na konci `docker compose -p dtclean … down` (bez `-v`, volumes nevznikli) a hlavný stack znova `up -d`.
- Pracuj po fázach. Na začiatku a konci fázy použi skill `/faza`. Po fáze sa zastav a počkaj na potvrdenie.

## Automatické kontroly (`.claude/`)
- Po každej úprave súboru hook spustí eslint (frontend, telematics) alebo ruff (app, ak je `ruff` nainštalovaný lokálne). Chybu oprav hneď.
- Pred ukončením odpovede hook spustí typecheck a testy telematiky pre balíky so zmenami. Kým neprejdú, nekonči.
- Subagent `reviewer` nezávisle skontroluje fázu voči zadaniu a ADR. Spusti ho pred commitom fázy.

## Lessons learned
Sem pridaj krátky riadok vždy, keď narazíš na chybu, ktorá by sa mohla zopakovať, alebo keď ťa používateľ opraví.
Formát: `- [oblasť] čo sa stalo → ako to robiť správne`. Keď sekcia narastie nad ~30 riadkov, zlúč podobné body.

- [docs] Názov „digitálne dvojča“ v zadaní je zastaraný → v UI a dokumentácii používaj „digitálny tieň“.
- [frontend] Projekt nemá konfiguráciu Prettier. `npx prettier --write` na celé priečinky preformátoval 9 nedotknutých stránok → neformátuj hromadne, drž štýl okolitého kódu (dlhé riadky ~130 znakov).
- [app] Balík `depotrack` je v image nainštalovaný ne-editovateľne, `docker compose run app …` testuje starý kód → bez rebuildu namontuj zdrojáky: `docker compose run --rm -e PYTHONPATH=/app/src -v "$(pwd -W)/app/src:/app/src" -v "$(pwd -W)/app/tests:/app/tests" app pytest` (Git Bash: `MSYS_NO_PATHCONV=1`).
- [shell] Bash heredoc so zložitým Python/TS obsahom (úvodzovky, `$`, backticky) padá → skript na úpravy zapíš do súboru v scratchpade (nástroj Write) a spusti ho. Python na Windows v `open(..., "w")` píše CRLF → používaj `newline=""`. V Git Bash daj pred príkazy s cestami ako `/admin` prefix `MSYS_NO_PATHCONV=1`.
- [security] Príklad `FORWARDED_ALLOW_IPS` s celým rozsahom docker sietí (172.16.0.0/12) by dovolil podvrhnúť X-Forwarded-For pre všetky limity vrátane loginu → dôveruj len presnej IP proxy a testuj, že hlavičku od nedôveryhodného klienta app ignoruje.
- [telematics] Podmienený ťah RNG (`if (…) rng.int(…)`) posunie celú ďalšiu postupnosť, keď sa zmení vstup → v kóde zdieľanom so scenárom „čo ak“ ťahaj vždy rovnaký počet čísel a test porovná KPI, ktoré sa meniť nemajú.
- [telematics] Nový stav v pamäti simulátora (okná údržby) prežil `restartDay` → každý taký stav vymaž v `restartDay` a pridaj test „akcia → restart → rovnaké skeny ako čistý engine“.
- [telematics] Súbežné behy vitestu (napr. hook + reviewer) padnú na `Cannot read properties of undefined (reading 'config')` → nejde o chybu testov, spusti znova sám.
- [frontend] Kliknutie na drei `Html` (DOM) sa v R3F hlási ako `onPointerMissed` a zruší výber → v handleri ignoruj ciele s `[data-pin]`. react-hooks 7 nedovolí meniť hodnotu z `useMemo`/props v `useFrame` → mutovateľné polia drž v `useRef`.
- [docs] Pred commitom fázy over `ls docs/screenshots/faza-N/` proti odkazom v `docs/fazy/faza-N-*.md`. Screenshoty s celou cestou (`stats.html`) prezradia meno používateľa → `projectRoot` vo visualizeri.
- [docs] Pri premenovaní (názov, terminológia) sa zabudli historické sekcie plánu a screenshoty → po premenovaní `grep -ri` cez celé `docs/` a skontroluj aj `docs/screenshots/`.
- [docs] Časy v `toISOString()` sú v UTC. Pri odhade návratu kuriérov to dalo omyl o 1 h → lokálny čas (Europe/Bratislava) over cez `localHhmm`.
- [frontend] Referenčný layout (docs/design/reference.png) bol vo Fáze 5 postavený ako karty pod sebou → v referencii je scéna cez celú plochu a panely plávajú nad ňou. Pri vizuálnej referencii porovnaj screenshot vedľa seba s referenciou, nielen komponenty.
