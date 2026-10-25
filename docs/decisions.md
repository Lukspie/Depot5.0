# Rozhodnutia (ADR)

Krátke záznamy architektonických rozhodnutí. Každé má kontext, rozhodnutie a dôsledok.
Nové rozhodnutia pridávaj na koniec, staré neprepisuj. Ak sa rozhodnutie zmení, pridaj nové ADR, ktoré to staré nahrádza.

---

## ADR-001 Repozitár v podpriečinku `depotrack/`, zadanie v `docs/PROMPT.md`
- **Kontext:** Zadanie leží v pracovnom priečinku mimo repozitára. Tím ho potrebuje mať pri kóde.
- **Rozhodnutie:** Repozitár je `depotrack/`. Zadanie je skopírované do `docs/PROMPT.md` a nemení sa. Odchýlky od zadania zapisujeme sem.
- **Dôsledok:** Platí to, čo je v PROMPT.md, plus zmeny v tomto súbore.

## ADR-002 Konfigurácia výhradne cez `.env`, povinné premenné zlyhajú nahlas
- **Kontext:** Do repozitára nesmú ísť tajomstvá a stack sa musí dať spustiť z čistého klonu.
- **Rozhodnutie:** Commitujeme len `.env.example` s dev hodnotami. Pred prvým štartom treba spustiť `cp .env.example .env`. V `docker-compose.yml` sú heslá a názvy DB zapísané ako `${VAR:?správa}`, takže keď `.env` chýba, compose skončí so zrozumiteľnou chybou a nespustí sa s prázdnym heslom.
- **Dôsledok:** Spustenie z čistého klonu má jeden krok navyše, je uvedený v README.

## ADR-003 Porty
- **Kontext:** Prehliadač potrebuje `app` aj `telematics`. Databázy chceme ukázať v DBeaveri, ale nie vystaviť do siete.
- **Rozhodnutie:** `app` → 8000, `telematics` → 8080. `db-wms` → `127.0.0.1:5433`, `db-telemetry` → `127.0.0.1:5434`.
- **Dôsledok:** K databázam sa dá pripojiť len z vlastného počítača.

## ADR-004 Frontend zisťuje adresu telematiky za behu, telematika obmedzuje originy
- **Kontext:** Frontend volá telematiku priamo (požiadavka „frontend spája oba backendy“). Telematika beží na inom origine, takže prehliadač vyžaduje CORS. Adresa sa líši podľa nasadenia a nemá byť zapečená v builde.
- **Rozhodnutie:** `app` vystavuje `GET /api/config` → `{ telematics_url }`. Telematika povoľuje CORS len pre originy z `TELEMATICS_ALLOWED_ORIGINS`. CORS sa na WebSocket nevzťahuje, preto telematika pri WS upgrade (Fáza 2) overí **hlavičku `Origin`** proti tomu istému zoznamu **a zároveň** WS ticket.
- **Dôsledok:** Jeden build frontendu funguje v každom prostredí. Pri zmene domény sa mení len `.env`.

## ADR-005 Node.js 20 napriek koncu podpory
- **Kontext:** Zadanie predpisuje Node.js 20. Ten je od 30. 4. 2026 po konci podpory (EOL). Najnovší vitest 5 ho už nepodporuje.
- **Rozhodnutie:** Držíme Node 20 (`node:20-alpine`) podľa zadania a vitest je pripnutý na v4. Ostatné nástroje (Vite 8, ESLint 10, TypeScript 6) Node 20.19+ ešte podporujú.
- **Dôsledok:** Prechod na Node 22 LTS je zmena dvoch riadkov `FROM` v Dockerfiloch a odporúčame ho, ak to vyučujúci dovolí.

## ADR-006 react-router 7 a Tailwind CSS 4
- **Kontext:** `npm audit` hlásil stredne závažné zraniteľnosti v react-router 6 (open redirect) a v závislostiach Tailwindu 3.
- **Rozhodnutie:** Používame `react-router` 7 (knižničný režim, beží s React 18) a Tailwind 4 (plugin `@tailwindcss/vite`, téma v `src/index.css` cez `@theme`).
- **Dôsledok:** `npm audit` je čistý. Farebné tokeny sú v CSS, nie v `tailwind.config.js`.

## ADR-007 Brány: predvolený smer vs. skutočné pridelenie
- **Kontext:** Brány sa v depe prideľujú na vlnu a nie sú napevno zviazané so smerom.
- **Rozhodnutie:** `doors.direction_id` je len **predvolený** smer brány. Skutočné pridelenie pre konkrétnu jazdu je `trips.door_id`. Väzbu M:N nerobíme.
- **Dôsledok:** Kontrola „zlý smer“ pri nakládke porovnáva smer balíka so smerom **jazdy** na bráne, nie s predvoleným smerom brány.

## ADR-008 Zoznam prechodových smerov
- **Kontext:** Zadanie uvádza Michalovce, Humenné, Stará Ľubovňa, Prešov, Poprad a Trebišov, no Trebišov nemá nakládkovú bránu. Tím zoznam upravil.
- **Rozhodnutie:** Prechody (`transit`) sú zatiaľ **Michalovce, Trebišov, Humenné, Stará Ľubovňa, Senica**. Spolu s BB, BA a ZA to dáva presne 8 nakládkových brán. Zoznam je v seed dátach a dá sa meniť v `/admin`.
- **Dôsledok:** Zoznam treba **overiť s doménovým expertom**. Najmä Senicu: leží na západnom Slovensku, takže prechod z Košíc je nezvyčajný a môže ísť skôr o linehaul cez BA.

## ADR-009 Tabuľka `alerts`
- **Kontext:** Dátový model nemá miesto pre alarmy (zlý smer, kaskáda meškania, ML anomália skenera, offline zariadenie).
- **Rozhodnutie:** V db-wms je tabuľka `alerts` (kind, severity, message, ref_type, ref_id, created_at, acknowledged_by, acknowledged_at).
- **Dôsledok:** Všetky typy alarmov majú jeden zoznam na dashboarde a jedno potvrdzovanie.

## ADR-010 Simulované SMS ukladajú celý odkaz, token len ako hash
- **Kontext:** Zákazník dostáva odkaz `/track/<token>`. Na demo ho treba vedieť otvoriť z admina, ale token nemá byť v DB v čitateľnej podobe.
- **Rozhodnutie:** `customer_notifications` predstavuje **odoslané SMS** a ukladá celý text vrátane odkazu `/track/<token>`. V `tracking_tokens` je len SHA-256 hash a overovanie ide výhradne cez hash.
- **Dôsledok:** Kto vidí notifikácie, vidí aj platné odkazy. Pri reálnej SMS bráne by to platilo pre jej log rovnako. Prístup k notifikáciám má preto len rola `admin`.

## ADR-011 Obrazovka kuriéra `/courier` vo Fáze 4
- **Kontext:** Rola `courier` v zadaní nemá obrazovku.
- **Rozhodnutie:** Vo Fáze 1 vznikne len rola a seed používatelia. Vo Fáze 4 pribudne jednoduchá mobile-first obrazovka `/courier`: moje zastávky a tlačidlá „Doručené“ a „Nezastihnutý“.
- **Dôsledok:** Doručenie z obrazovky kuriéra zneplatní tracking token rovnako ako sken.

## ADR-012 Migrácie db-telemetry vlastným runnerom
- **Kontext:** Skripty v `docker-entrypoint-initdb.d` sa spustia len pri prázdnom volume, takže neskoršie zmeny schémy by sa neaplikovali.
- **Rozhodnutie:** Telematika pri štarte aplikuje `telematics/sql/NNN_*.sql` v poradí a zapisuje ich do tabuľky `schema_migrations`. Nepotrebuje na to novú závislosť.
- **Dôsledok:** Schéma db-telemetry sa správa ako Alembic v db-wms: pridáš nový očíslovaný súbor a ten sa aplikuje.

## ADR-013 Ťažké ML závislosti až vo Fáze 6, CV skripty na hostovi
- **Kontext:** torch, ultralytics a easyocr majú stovky MB. Skripty pre webkameru a video potrebujú prístup ku kamere počítača.
- **Rozhodnutie:** Do image `app` ich pridáme až vo Fáze 6, torch v **CPU** verzii. `ml/gate_video.py` a `ml/dock_scanner.py` bežia na hostovi a posielajú dáta cez API, takže zostávajú 4 kontajnery.
- **Dôsledok:** Fázy 0 až 5 sa zostavujú rýchlo. Na obhajobe treba mať na notebooku Python prostredie pre `ml/`.

## ADR-014 CSRF ochrana
- **Kontext:** Sessions sú v cookie, takže hrozí CSRF.
- **Rozhodnutie:** Cookie má `SameSite=Strict`. Navyše `app` pri zmenových požiadavkách (POST, PUT, PATCH, DELETE) overuje hlavičku `Origin` proti povolenému originu.
- **Dôsledok:** CSRF tokeny vo formulároch nie sú potrebné.

## ADR-015 Kde bežia testy
- **Kontext:** Testy `app` potrebujú PostgreSQL. Lokálne verzie Pythonu a Node sa u členov tímu líšia.
- **Rozhodnutie:** Testy, lint a typy pre `app` bežia v kontajneri (`docker compose run --rm app pytest`), preto image `app` obsahuje aj dev závislosti. Testy telematiky a frontendu bežia cez `npm` lokálne a nepotrebujú DB.
- **Dôsledok:** Image `app` je o pár desiatok MB väčší. Pre školský prototyp je to prijateľné.
