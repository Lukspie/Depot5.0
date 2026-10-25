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

## ADR-005 Node.js 22 LTS namiesto Node.js 20 *(upravené vo Fáze 1)*
- **Kontext:** Zadanie predpisuje Node.js 20. Ten je od 30. 4. 2026 po konci podpory (EOL), takže už nedostáva bezpečnostné opravy. Nové verzie nástrojov ho prestávajú podporovať (napr. vitest 5).
- **Rozhodnutie:** Vo Fáze 0 sme zostali na Node 20 s vitestom 4. Od Fázy 1 tím schválil **Node.js 22 LTS**: `node:22-alpine` v oboch Dockerfiloch, `engines.node >=22.12` vo `frontend` aj `telematics`, `@types/node@22` a vitest 5. CI v repozitári zatiaľ nie je.
- **Dôsledok:** Runtime má podporu do apríla 2027. Lokálny vývoj potrebuje Node 22.12 alebo novší.

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

## ADR-016 Sessions: v DB len hash, pevná dĺžka smeny, zrušenie pri zmene účtu
- **Kontext:** Zadanie vyžaduje server-side sessions v tabuľke `sessions`, HttpOnly + SameSite=Strict cookie, expiráciu 8 h a zmazanie pri odhlásení.
- **Rozhodnutie:** Cookie `depotrack_session` nesie náhodný token (256 bitov). V `sessions.id` je len jeho SHA-256, takže únik databázy neprezradí platné cookies. Expirácia je pevných 8 h od prihlásenia, bez predlžovania pri aktivite, lebo zodpovedá smene. Deaktivácia účtu, zmena roly alebo hesla zmaže všetky sessions daného používateľa. Expirované riadky maže úloha APScheduler každých 15 min.
- **Dôsledok:** Po zmene roly sa používateľ musí prihlásiť znova. Atribút `Secure` sa zapína cez `SESSION_COOKIE_SECURE=true`, keď beží HTTPS.

## ADR-017 RBAC s explicitnými zoznamami rolí, admin má prístup všade *(upravené vo Fáze 2)*
- **Kontext:** Tabuľka obrazoviek v zadaní uvádza pre každú obrazovku konkrétne roly, napr. `/fleet` je len pre dispečera a `/loading` len pre operátora. Na demo a správu systému však admin potrebuje vidieť všetko.
- **Rozhodnutie:** Každý endpoint uvádza povolené roly cez `require_role(...)` a **rola `admin` je povolená vždy** (pridá sa automaticky v `core/rbac.py`). Frontend skrýva položky menu podľa roly (`frontend/src/auth/roles.ts`), admin vidí všetky. O prístupe rozhoduje vždy backend.
- **Dôsledok:** Matica rolí sa testuje v `tests/test_rbac_admin.py`. Pôvodná verzia z Fázy 1 (admin len tam, kde je výslovne uvedený) bola nahradená na žiadosť tímu.

## ADR-018 Seed: idempotentné kroky, deterministický generátor, syntetické adresy
- **Kontext:** Seed sa spúšťa automaticky pri každom štarte kontajnera. Nesmie duplikovať dáta ani prepísať zmeny z adminu.
- **Rozhodnutie:** Seed má kroky (`reference:v1`, `users:v1`, `waves:<dátum>`, `parcels:<dátum>`). Každý krok sa zapíše do `seed_meta` v tej istej transakcii a druhýkrát sa už nespustí. Heslá sú z `.env` (`SEED_*_PASSWORD`). Balíky generuje deterministický generátor (`SEED_RANDOM_SEED`) pre aktuálny deň. Hmotnosť je lognormálna s mediánom 1,8 kg. Košické adresy sú náhodné body v kruhu s polomerom 5,5 km okolo centra. Rajón KE-01 až KE-08 je **kompasový sektor po 45°** (od severu v smere hodinových ručičiek). Názov ulice sa vyberá náhodne a s polohou bodu nesúvisí.
- **Dôsledok:** Dáta sú pri každom čistom štarte rovnaké, čo pomáha pri deme aj testoch. Jazdy (`trips`) a trasy kuriérov zatiaľ nevznikajú: jazdy pridá simulátor vo Fáze 2, trasy Fáza 4.

## ADR-019 Chybové správy API po anglicky, UI ich prekladá
- **Kontext:** UI má byť celé po slovensky, kód a identifikátory po anglicky.
- **Rozhodnutie:** API vracia štandardné FastAPI `{"detail": "..."}` s anglickým textom pre vývojárov. Frontend zobrazuje slovenskú hlášku podľa HTTP kódu (napr. 401 → „Nesprávne používateľské meno alebo heslo.“, 429 → „Príliš veľa pokusov…“).
- **Dôsledok:** Preklady sú na jednom mieste vo frontende a API je konzistentné so zvyškom FastAPI.

## ADR-020 Zariadenia db-telemetry ako SQL migrácia
- **Kontext:** Zariadenia (skenery, kamera, senzory) patria do db-telemetry, ktorú vlastní telematika.
- **Rozhodnutie:** Zoznam zariadení je v `telematics/sql/002_seed_devices.sql` s `ON CONFLICT DO NOTHING`. Väzba na bránu ide cez `door_code` (= `doors.code` v db-wms). Cudzí kľúč naprieč databázami neexistuje.
- **Dôsledok:** Pri premenovaní brány v db-wms treba upraviť aj `devices.door_code`. Pre prototyp je to prijateľné.

## ADR-021 Vizuálny cieľ podľa referenčného dashboardu
- **Kontext:** Slová „pastelové, moderné“ nestačia. Tím dodal screenshoty izometrického dashboardu skladu.
- **Rozhodnutie:** Referencia je `docs/design/reference.png` (plus 3 ďalšie zábery). Popis toho, čo z nej preberáme, je v `docs/design/README.md`. Platí pre celú aplikáciu, nielen pre dvojča. Logo, názov ani obsah referencie nepreberáme.
- **Dôsledok:** Vo Fáze 3 vznikne design systém (`frontend/src/components/ui`) podľa tejto referencie (pozri `docs/plan-doplnky.md`).

## ADR-022 Plán jázd vlastní app, prevádzkový deň 15:00–15:00
- **Kontext:** Zadanie hovorí, že app je zdroj pravdy pre jazdy, ale simulátor ich vykonáva. Denný cyklus depa prechádza cez polnoc (večerná vlna, nočné kamióny, ranné odchody).
- **Rozhodnutie:** App vytvára plán jázd dňa v `services/trip_plan.py`. **Prevádzkový deň D** trvá od 15:00 dňa D do 15:00 dňa D+1. Patrí doň 5 návratov regionálnych kamiónov, 3 večerné diaľkové odchody, 3 nočné diaľkové príchody a 5 ranných regionálnych odchodov, spolu 16 jázd. Do `trips` pribudol stĺpec `operating_day`, čo je odchýlka od dátového modelu zadania. Plán aj balíky dňa vzniknú pri prvej požiadavke (`GET /internal/plan?day=`), takže simulácia môže bežať viac dní. Diaľkové kamióny sa striedajú: kto prišiel v noci, ide na druhý deň večer späť.
- **Dôsledok:** Telematika len hlási vykonanie (stav, skutočné časy, predikcia príchodu) cez `POST /internal/events/trips`. App ho zrkadlí a vyhodnocuje kaskádu.

## ADR-023 Deterministický simulátor
- **Kontext:** Pri rovnakom `SIM_RANDOM_SEED` sa má deň odohrať rovnako, aby sa demo dalo zopakovať a testovať.
- **Rozhodnutie:**
  - Scenár dňa (`telematics/src/simulator/scenario.ts`) je **čistá funkcia** (plán, seed). Určuje meškania, poruchu, nečakané autá na bráne a rozvrh skenov.
  - Každé náhodné rozhodnutie má vlastný prúd náhody podľa kľúča `(seed, deň, predmet…)` (`rng.ts`, sfc32 + cyrb128). Výsledok preto nezávisí od veľkosti tiku ani od poradia spracovania.
  - Seed sa nastavuje v `.env` (`SIM_RANDOM_SEED`, prejaví sa pri štarte, ak sa zmenil) a cez `PUT /sim/seed` (admin). Zmena seedu spustí aktuálny prevádzkový deň znova od 15:00 a telemetria od tohto času sa zmaže. Dostupné je aj `POST /sim/restart-day`.
- **Dôsledok:** Test `engine.test.ts` overuje, že rovnaký seed dá rovnaké skeny aj pri inom kroku tiku. Jedno obmedzenie: manifesty balíkov sa berú z app v čase načítania dňa, takže ak by sa medzitým zmenili stavy balíkov (Fáza 3), deň sa odohrá s aktuálnymi dátami.

## ADR-024 Zaručená kaskáda a degradácia skenera v predvolenom scenári
- **Kontext:** Tím požaduje, aby predvolený seed vždy obsahoval degradáciu skenera aj meškanie nočného kamióna s kaskádovým varovaním.
- **Rozhodnutie:**
  - `SIM_FORCE_CASCADE=true` (predvolené): jeden nočný diaľkový kamión (vybraný seedom) má na trase poruchu. Jej dĺžka je vypočítaná tak, aby `príchod + triediaci buffer` prekročil najskorší odchod prechodu, ktorý od kamióna závisí (+5 až 35 min). Dispečing sa o meškaní dozvie v okamihu poruchy, keď sa zmení predikcia príchodu.
  - Prechod v simulácii naozaj čaká, kým jeho nočné kamióny prídu a sú vytriedené.
  - Degradácia: `SIM_DEGRADED_DEVICE=DOCK-SCN-02` (brána BA, najväčší objem) stráca čítanosť **0,97 → 0,85 za 6 h** (`SIM_DEGRADATION_HOURS`) od 15:30 prvého dňa. Zadanie uvádza príklad „za deň“, ale 6 h zodpovedá jednej večernej vlne, takže pokles je viditeľný počas jedného dema. Admin môže skener „opraviť“ (`PUT /sim/devices/DOCK-SCN-02 {"repair":true}`).
- **Dôsledok:** Pri seede 42 je porucha na kamióne BA (príchod 05:35 namiesto 01:30) a ohrozuje Michalovce a Humenné (odchod 06:00). Overené end-to-end, alarmy vznikli v db-wms.

## ADR-025 Skok hodín je „fast-forward“
- **Kontext:** Admin môže preskočiť napr. z 15:00 na 01:00. Vygenerovať všetky skeny za 10 h naraz by nemalo zmysel a zahltilo by to klientov.
- **Rozhodnutie:** Ak sa simulovaný čas v jednom tiku posunie o viac ako 15 min, stavy jázd, polohy a predikcie sa prepočítajú na nový čas, ale **preskočené skeny, prejazdy a merania senzorov sa negenerujú**.
- **Dôsledok:** Po skoku chýbajú za preskočený interval dáta v db-telemetry. Kto chce súvislé dáta, zrýchli hodiny (`PUT /sim/clock/speed`) namiesto skoku.

## ADR-026 Heartbeat zariadení v reálnom čase
- **Kontext:** Zadanie: heartbeat každých 10 s, bez heartbeatu 30 s = offline. Pri rýchlosti 60× by 10 simulovaných sekúnd bola šestina reálnej sekundy.
- **Rozhodnutie:** Heartbeat a detekcia výpadku bežia v **reálnom** čase (10 s / 30 s). Záznamy v `device_heartbeats` majú simulovaný čas. Vypnuté zariadenie (`PUT /sim/devices/:code {"enabled":false}`) prestane posielať heartbeat, po 30 s je offline a app dostane kritický alarm. Po zapnutí sa alarm uzavrie.
- **Dôsledok:** Výpadok sa dá predviesť za pol minúty bez ohľadu na rýchlosť simulácie.

## ADR-027 Prístup k telematike: ticket alebo service token
- **Kontext:** Prehliadač nemá k telematike session cookie (iný origin). Ovládanie simulácie má byť len pre admina.
- **Rozhodnutie:**
  - WebSocket: `ws://…/ws?ticket=<JWT>`, kontrola `Origin` + ticket. Ticket je **na jedno použitie** (jti si telematika pamätá do expirácie).
  - REST ovládanie (`/sim/...`, `/devices`): `Authorization: Bearer <ticket>`, pričom ticket sa dá počas 60 s použiť opakovane. Rola sa kontroluje ako v app (admin vždy prejde). Service token (`X-Service-Token`) prejde tiež.
  - `GET /sim/clock` je verejné, aby si app a tabuľa vedeli prečítať čas.
- **Dôsledok:** Admin UI (Fáza 3) si pred volaním telematiky vypýta ticket z app. Žiadne heslá ani session neopúšťajú app.

## ADR-028 Známe zjednodušenia simulátora vo Fáze 2
- **Kontext:** Niektoré časti simulácie závisia od funkcií ďalších fáz.
- **Rozhodnutie:**
  - **Kuriérske dodávky** sa zatiaľ nepohybujú. Ich trasy (zastávky, nearest neighbor) vzniknú v app vo Fáze 4 a vtedy ich simulátor rozhýbe.
  - Nočné kamióny **neprinášajú nové balíky**. Ranná vlna na linke a ranná nakládka pracujú s balíkmi odstavenými večer. Generovanie nočných balíkov pribudne vo Fáze 3 spolu s ich spracovaním.
  - Skeny sa zatiaľ **neposielajú do app**. Kontrola smeru, `loading_scans` a stavy balíkov sú jadro WMS vo Fáze 3. Telematika ich ukladá do db-telemetry a posiela na WebSocket.
  - Trasy sú zjednodušené polylíny cez okresné mestá (`telematics/data/routes.json`) s priemernou rýchlosťou 72 km/h. **Senica** je vzdialená ~6 h, takže jej ranný odchod a večerný návrat sa časovo prekrývajú. Zobrazí sa novšia jazda (pozri ADR-008).
- **Dôsledok:** Tieto body sú výslovne naplánované vo Fázach 3 a 4.

## ADR-029 Stav simulátora prežije reštart kontajnera
- **Kontext:** Reštart telematiky by inak vrátil hodiny na 15:00 a stavy jázd v app by „cúvli“.
- **Rozhodnutie:** Tabuľka `sim_state` v db-telemetry (`sql/003_sim_state.sql`) drží simulovaný čas, rýchlosť, pauzu, seed a začiatok degradácie. Ukladá sa každých 10 s a pri každej zmene. Po štarte simulácia pokračuje od uloženého času.
- **Dôsledok:** Čas „stojí“, kým je kontajner vypnutý. Úplne nový štart: `POST /sim/restart-day`, prípadne zmena seedu.

## ADR-030 Kaskádové alarmy: jeden na dvojicu (prechod, nočný kamión), automatické uzavretie
- **Kontext:** Prechod môže závisieť od viacerých nočných kamiónov a predikcia sa počas noci mení.
- **Rozhodnutie:** Alarm `cascade_delay` má `ref_type="cascade"` a `ref_id="<id jazdy prechodu>:<id nočnej jazdy>"`.
  - Pri zhoršení predikcie sa existujúci alarm aktualizuje (správa, závažnosť), nevzniká nový.
  - Závažnosť je `warning`, ak sa nestihne len triedenie, a `critical`, ak kamión príde až po odchode prechodu.
  - Keď predikcia klesne pod hranicu, alarm sa automaticky uzavrie (`acknowledged_at`, bez používateľa). Odídený prechod sa už nehodnotí.
- **Dôsledok:** Dispečer nevidí duplicitné ani zastarané varovania. Každá zmena ide cez WebSocket kanál `alerts`.
