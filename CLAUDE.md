# DepoTrack – pamäť projektu pre coding agenta

WMS prototyp pre prekládkové depo SPS (Budimír pri Košiciach, hub Bratislava). Školský tímový projekt AISPU.
Proces depa je reálny, dáta sú simulované. Tento súbor si prečítaj na začiatku každej session.

## Zdroje pravdy (čítaj podľa potreby, neopakuj ich sem)
- Zadanie: `docs/PROMPT.md` (povinné podmienky §1, fázy §10, pravidlá §11)
- Doplnky schválené tímom: `docs/plan-doplnky.md`
- Rozhodnutia: `docs/decisions.md` (ADR-001 až …). Pred zmenou architektúry nájdi súvisiace ADR.
- Vysvetlenia hotových fáz: `docs/fazy/` · design systém: `docs/design/komponenty.md`
- Vizuálny cieľ `/shadow`: schválená maketa `docs/design/maketa-tien/` (`tien-maketa.png`), nie `reference.png`
- Stav projektu: `git log --oneline` (každá fáza = jeden commit `feat: phase N - …`)

## Architektúra v skratke (nič nepridávaj)
| Služba | Stack | Port |
| --- | --- | --- |
| `app` | Python 3.12, FastAPI, SQLAlchemy 2, Alembic. Servíruje aj frontend (React, Vite, TS, Tailwind 4) | 8000 |
| `telematics` | Node.js 22, TypeScript, Fastify, ws. Simulátor, sim. hodiny, ETA, WebSocket | 8080 |
| `db-wms` / `db-telemetry` | PostgreSQL 16 | 5433 / Azure (5434 v profile `local`) |

- **db-telemetry je predvolene v Azure Database for PostgreSQL** (`TELEMETRY_DATABASE_URL`, `sslmode=require`, ADR-056). Kontajner `db-telemetry` je záloha v compose profile `local` (`COMPOSE_PROFILES=local` + prázdne URL). Iné kontajnery nepridávaj.

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
  - naklonuj repo do dočasného priečinka a skopíruj `.env.example` → `.env`, v ňom nastav `COMPOSE_PROFILES=local` a `TELEMETRY_DATABASE_URL=` (offline, bez Azure),
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
- [telematics] Coalescing kľúč v `hub.publish` je spoločný pre celý kanál → rôzne typy udalostí toho istého objektu musia mať rôzne kľúče (`door:CODE` vs `CODE`), inak sa v dávke prepíšu.
- [shadow] Stav zo senzora pri vypnutom alebo offline senzore nesmie ostať zobrazený ako platný → pri strate zdroja kresli neutrálny stav, nie posledný známy.
- [frontend] drei `Bounds.fit()` s `frameloop="demand"` kameru spoľahlivo nepohol → zaostrenie rieš priamo (cieľ OrbitControls + zoom ortho kamery cez `useThree(s => s.get)`), efekty s WS dátami v závislostiach rušia `setTimeout` pri každej zmene.
- [docs] Pred commitom fázy over `ls docs/screenshots/faza-N/` proti odkazom v `docs/fazy/faza-N-*.md`. Screenshoty s celou cestou (`stats.html`) prezradia meno používateľa → `projectRoot` vo visualizeri.
- [docs] Pri premenovaní (názov, terminológia) sa zabudli historické sekcie plánu a screenshoty → po premenovaní `grep -ri` cez celé `docs/` a skontroluj aj `docs/screenshots/`.
- [docs] Časy v `toISOString()` sú v UTC. Pri odhade návratu kuriérov to dalo omyl o 1 h → lokálny čas (Europe/Bratislava) over cez `localHhmm`.
- [app] Staré nedokončené jazdy (stack vypnutý niekoľko dní) blokovali brány. Prvá oprava „dnes + včera“ nechala práve výpadok o 1 deň, lebo staršia jazda vyhrá v `order_by` → pri filtri podľa prevádzkového dňa over v `trip_plan`, do ktorého dňa jazda patrí. Test má mať starú aj aktuálnu jazdu naraz. Nájdi všetky dotazy s rovnakou podmienkou (`grep "AT_DOOR, TripStatus.LOADING"`).
- [frontend] Geometria naklonovaná v `useMemo` sa pri unmounte neuvoľní (R3F uvoľní len to, čo vytvorí z JSX) → zdieľanú geometriu pre inštancie drž v cache modulu, alebo ju uvoľni v cleanup efekte.
- [assets] kenney.nl vracia botom 403 → kontrolu neobchádzaj, kit stiahne používateľ ručne do `tools/kenney/` (gitignored). `docker compose build` padol na PyPI read timeout → nejde o chybu kódu, zopakuj build.
- [docs] Pri 30× ubehne počas review a testov 10+ h simulácie → screenshot časovo viazanej scény (dodávky 07:00–07:35, nočné kamióny) urob hneď po skoku. Po screenshote vráť rýchlosť na 30×.
- [telematics] Fastify AJV má `removeAdditional: true`: v `oneOf` so schémami s `additionalProperties: false` vymaže polia už pri porovnaní s inou vetvou, takže `read_rate` a `move_trip` v what-if nikdy neprešli → varianty rozlišuj podľa `kind` (`if/then`, `discriminator`). **Každý variant API schémy má aspoň jeden test cez HTTP, nielen test výpočtu** (aj v checkliste reviewera).
- [telematics] Dávkové posielanie do app (replay po 10 min) poslalo „departed“ pred poslednými skenmi jazdy a replay cez 15:00 nečakal na načítanie nového dňa (`void ensureDay`) → pri dávkach posielaj skeny pred stavom, ktorý ich ukončí, v rýchlej slučke čakaj na asynchrónne načítanie a testuj poradie a pomalý FakeApp, nielen konečný stav. Vzájomné vylúčenie (replay, reset, seed) drž v Engine (mutex), nie v jednotlivých routách.
- [app] Súbežné behy pytestu (môj + reviewer) zhadzujú spoločnú `depotrack_test` (`DROP DATABASE … FORCE`) a padajú náhodne (`KeyError`, visiace kontajnery) → nespúšťaj pytest, kým beží reviewer s testami app; pri podivnej chybe over `docker ps | grep run` a spusti znova sám.
- [ml] História pokryla len máj–november (žiadny sneh) a deň v týždni bol v tréningu 0–6, v inferencii 1–7, test to zakryl inou premennou → over pokrytie kategórií a sezón, generátor s pevným koncom, test mení vždy jeden príznak, kontraktný test kódovania tréning = inferencia. Syntetický test musí mať živý objem dát (skener: ~1 položka/min, nie 2,2 z generátora).
- [config] Placeholder v `.env.example`, ktorý nejde naparsovať, zhodil službu a neodchytená chyba by vypísala URL s heslom → `.env.example` musí naštartovať bez úprav, tajné URL validuj v try/catch bez obsahu v chybe.
- [sim] Nová db-telemetry (Azure) začala „dnes“, db-wms mala neskoršie dni → `SIM_START_DATE` posúva uložené hodiny vpred. Reset a filtre dňa ohranič zhora (`< start + 1 d`). Akcia pri štarte telematiky, ktorá volá app, musí čakať na pozadí (app štartuje až po zdravej telematike).
- [telematics] Fronta udalostí kuriérov je len v pamäti, reštart počas rozvozu nechal zastávky otvorené → po načítaní dňa znova posielaj už prebehnuté idempotentné udalosti (nie tie s vedľajším efektom, napr. SMS).
- [shell] Login má limit 10/min: skript na screenshoty sa prihlási raz na používateľa a znova použije `storageState`. `python - <<'EOF'` s `\\\n` v reťazci zapísal do Dockerfile doslovné `\n` → viacriadkové úpravy súborov rob nástrojom Edit.
- [app] `test_migrations_downgrade_and_upgrade` znova vytvorí enum typy s novými OID, pripravené príkazy psycopg v poole potom padali na `cache lookup failed for type` (objavilo sa až s viac testami) → po round-tripe migrácií `get_engine().dispose()`.
- [security] Pravidlo „nízka istota → človek“ preskočilo prípad, keď model nič nenašiel (None ≠ nízka istota), takže vytlačená ŠPZ otvorila bránu → chýbajúca detekcia = istota 0, ku každému prahu test aj bez detekcie. Rozhodnutie človeka nad otvoreným záznamom zamkni (`with_for_update`), číselník, na ktorý odkazuje audit, maž len logicky.
- [docs/meranie] ADR tvrdilo „0 % zmeškaných okien“ zo 16 trás. Na všetkých 648 trasách to bolo 0,2 %, trasy boli dlhšie a väčšina návratov po 15:00, porovnávalo sa navyše so zlou baseline → meraj na všetkých dátach, uveď vedľajšie efekty (čas, koniec dňa), porovnaj so skutočnou predchádzajúcou verziou a skript commitni (`tools/measure_routes.py`). Akciu viazanú na fázu dňa (sken „pred odchodom naloží“) vynúť na serveri a testuj aj „príliš skoro“ a „príliš neskoro“.
- [telematics] Zmena stavu z `null` na `"parked"` potichu zmenila `status !== null` v engine (zaparkovaná dodávka posielala včerajšie kolo) a čas 07:00 → 06:30 ostal v README, UI a OpenAPI → pri zmene enumu alebo konštanty `grep` všetkých konzumentov a textov, test na výstupe engine a HTTP test tesne za novou hranicou.
- [osm] Hľadanie podľa názvu našlo pomenovaný areál a nepomenovanú halu vnútri vynechalo, kandidáti dostali tag z pamäti → pri pomenovanom `landuse` vypíš budovy vnútri (bod v polygóne), tagy ber z výstupu skriptu, bbox ako parameter (`find_hub.py`).
- [privacy] Do User-Agent pri sťahovaní z webu nedávaj e-mail používateľa bez súhlasu.
- [frontend] Referenčný layout (docs/design/reference.png) bol vo Fáze 5 postavený ako karty pod sebou → v referencii je scéna cez celú plochu a panely plávajú nad ňou. Pri vizuálnej referencii porovnaj screenshot vedľa seba s referenciou, nielen komponenty.
