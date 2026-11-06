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

## ADR-008 Zoznam prechodových smerov *(upravené vo Fáze 3)*
- **Kontext:** Zadanie uvádza Michalovce, Humenné, Stará Ľubovňa, Prešov, Poprad a Trebišov, no Trebišov nemá nakládkovú bránu. Tím zoznam upravil.
- **Rozhodnutie:** Prechody (`transit`) sú **Michalovce, Trebišov, Humenné, Stará Ľubovňa, Senica**. Spolu s BB, BA a ZA to dáva presne 8 nakládkových brán. Zoznam je v seed dátach a dá sa meniť v `/admin`. **Senica je potvrdená tímom.** Bola pridaná zámerne, nejde o chybu ani o dočasný príklad.
- **Dôsledok:** Senica je ~6 h jazdy, takže jeden kamión nestihne odísť ráno a vrátiť sa v ten istý deň. Rieši to ADR-031.

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
- **Rozhodnutie:** Referencia je `docs/design/reference.png` (plus 3 ďalšie zábery). Popis toho, čo z nej preberáme, je v `docs/design/README.md`. Platí pre celú aplikáciu, nielen pre digitálny tieň. Logo, názov ani obsah referencie nepreberáme.
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
  - **Kuriérske dodávky** sa zatiaľ nepohybujú. Ich trasy (zastávky, nearest neighbor) vzniknú v app vo Fáze 4 a vtedy ich simulátor rozhýbe. *(Vyriešené vo Fáze 4, ADR-041.)*
  - Nočné kamióny **neprinášajú nové balíky**. Ranná vlna na linke a ranná nakládka pracujú s balíkmi odstavenými večer. Generovanie nočných balíkov pribudne vo Fáze 3 spolu s ich spracovaním.
  - Skeny sa zatiaľ **neposielajú do app**. Kontrola smeru, `loading_scans` a stavy balíkov sú jadro WMS vo Fáze 3. Telematika ich ukladá do db-telemetry a posiela na WebSocket.
  - Trasy sú zjednodušené polylíny cez okresné mestá (`telematics/data/routes.json`) s priemernou rýchlosťou 72 km/h. **Senica** je vzdialená ~6 h. Časové prekrytie jej jázd rieši od Fázy 3 striedanie dvoch kamiónov (ADR-031).
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

## ADR-031 Senica: dva kamióny v striedaní
- **Kontext:** Jazda Košice – Senica trvá ~6 h. Kamión, ktorý ráno o 06:30 odíde z Košíc, je v Senici ~12:40. Večerný návrat do Košíc (16:45) by musel zo Senice vyraziť už ~10:45, takže jeden kamión nemôže robiť oboje v ten istý deň.
- **Rozhodnutie:** Smer SE má **dva kamióny (KE-205TR a KE-206TR), ktoré sa striedajú podľa prevádzkového dňa**. Kamión, ktorý večer príde zo Senice, ráno odchádza späť, prespí v Senici a do Košíc sa vráti až o deň neskôr. V ten deň medzitým jazdí ten druhý. Počet kamiónov v striedaní je v `TRUCK_ROTATION` (`app/src/depotrack/seed/reference.py`). Ostatné prechody majú jeden kamión, lebo sa stihnú otočiť za deň.
- **Dôsledok:** Žiadne vozidlo nemá prekrývajúce sa jazdy, čo overujú testy v app aj v telematike. Využije sa tým rezervný regionálny kamión KE-206TR.

## ADR-032 Témy Oranžová a Modrá, design systém vo `components/ui` *(upravené pred Fázou 5)*
- **Kontext:** Tím chce farby, ako by systém používal prepravca SPS (oranžová, čierna, sivá), a zároveň vizuálny štýl referenčného dashboardu (ADR-021).
- **Rozhodnutie:**
  - Farby sú tokeny v `frontend/src/index.css` a prepínajú sa cez `<html data-theme>`. Predvolená je **`oranzova`** (pôvodne `sps`, premenovaná v ADR-044): primárna oranžová `#f39200`, čierna navigácia `#1d1d1b` a teplá sivá plocha. Druhá téma je **`modra`** podľa referencie. Prepínač je v hornej lište a voľba sa pamätá v prehliadači.
  - Stavové farby (ok/info/warn/danger/neutral) sú v oboch témach rovnaké. „warn“ je v Oranžovej téme jantárová, aby sa neplietla s oranžovou značkou.
  - Text na oranžovom tlačidle je čierny (`on-brand`) kvôli kontrastu.
  - Logo SPS nepoužívame, Depot 5.0 má vlastnú značku.
  - Komponenty a pravidlá (nezalamovanie štítkov, pevné šírky stĺpcov, kontrola pri 1280/1440/390 px) sú opísané v `docs/design/komponenty.md`.
  - Nové závislosti: `lucide-react` (ikony), `leaflet` + `react-leaflet` 4 (mapa Flotily podľa zadania; verzia 4 je posledná pre React 18).
- **Dôsledok:** Všetky obrazovky používajú len tokeny a komponenty z `components/ui`, takže zmena farieb jednej témy sa prejaví všade.

## ADR-033 Reset prevádzkového dňa aj v app
- **Kontext:** Od Fázy 3 app drží stavy balíkov a skeny. Keď telematika prehrá deň znova (zmena seedu, `POST /sim/restart-day`), musí sa vrátiť aj stav v app, inak by sa „replay“ líšil od prvého behu.
- **Rozhodnutie:** Telematika pri reštarte dňa zavolá `POST /internal/days/{deň}/reset`. App vtedy:
  - vráti jazdy dňa do stavu `planned` a zmaže skutočné a predikované časy,
  - vráti balíky dňa do stavu `collected` a zmaže ich udalosti okrem `collected`,
  - zmaže `loading_scans` jázd dňa a alarmy od 15:00 toho dňa,
  - umožní znova uzavrieť večernú vlnu.
  Plán a samotné balíky zostanú. Ak app nie je dostupný, reštart zlyhá a admin dostane chybu.
- **Dôsledok:** Rovnaký seed dá rovnaký deň aj v dátach app. Overuje to test `test_day_reset_undoes_execution_for_a_replay`.

## ADR-034 Pravidlá nakládky, vĺn a nočných balíkov
- **Kontext:** Jadro WMS: kontrola smeru pri nakládke, chýbajúce balíky a nočné kamióny s balíkmi pre východ (odložené z ADR-028).
- **Rozhodnutie:**
  - **Jazda pri bráne** je najskoršia ešte neodídená odchodová jazda s `trips.door_id` = brána (ADR-007).
  - **Výsledok skenu:**
    - `ok`: balík patrí do smeru jazdy, dostane stav `loaded` a udalosť s bránou, jazdou a zdrojom `iot` alebo `manual`.
    - `wrong_direction`: kritický alarm „vyložiť“, jeden na balík.
    - `duplicate`: balík je už v tomto kamióne.
    - `unidentified`: štítok sa neprečítal alebo kód nepoznáme. Položka sa počíta, ale balík sa neurčí.
  - **Ručný skener** (`POST /api/loading/doors/{brána}/scan`) ide rovnakou cestou so zdrojom `manual` a menom operátora.
  - **Skener na linke** (ranná vlna) mení stav balíka na `on_belt` a hneď `sorted`.
  - **Večerná vlna** sa uzatvára o 22:00: regionálne a košické balíky, ktoré ešte čakajú, prejdú do stavu `staged` (odstavené do rána). Diaľkové balíky, ktoré nestihli kamión, zostanú `collected` a sú vedené ako **chýbajúce**.
  - **Nočné balíky:** pri vytvorení plánu dňa vznikne pre každý nočný diaľkový kamión 110–190 balíkov pre prechody, ktoré od neho závisia, a pre košické rajóny. Ich udalosť `collected` nesie `trip_id` kamióna, takže manifest pre telematiku obsahuje `arrivesWithTripId`. Simulátor ich na linke a pri bráne naskenuje až po príchode kamióna, takže pri poruche (ADR-024) prídu neskoro aj jeho balíky.
  - **Balíky dňa D** sú tie s `created_at` v intervale ⟨D 00:00, D+1 07:00).
- **Dôsledok:** Chýbajúce balíky pri bráne = balíky smeru a dňa, ktoré ešte nie sú naložené. Porovnanie s počtom neidentifikovaných položiek ukáže operátorovi, či ide o nečitateľné štítky alebo o balíky, ktoré naozaj chýbajú.

## ADR-035 Čítanosť: deň v app, aktuálny stav zariadenia v telematike
- **Kontext:** Telematika počíta čítanosť zariadenia len z posledných 30 simulovaných minút a až od 30 položiek, takže mimo vlny je prázdna.
- **Rozhodnutie:** KPI „Čítanosť“ na dispečingu a na tabuli je **podiel prečítaných štítkov zo všetkých položiek pri nakládke za prevádzkový deň** a počíta ju app z `loading_scans`. Stav zariadenia (online/degradované/offline) a krátkodobá čítanosť pre admin a digitálny tieň zostávajú v telematike.
- **Dôsledok:** KPI je stabilné a vysvetliteľné („z 1 000 balíkov sa 104 nedalo prečítať“). Degradáciu konkrétneho skenera ukazuje telematika a vo Fáze 6 ML model.

## ADR-036 Formát nových API: camelCase
- **Kontext:** WebSocket udalosti a interné API sú v camelCase, kým API z Fázy 1 (`/api/auth`, `/api/admin/users`) je v snake_case.
- **Rozhodnutie:** Nové API obrazoviek (dispečing, nakládka, tabuľa, flotila, balíky, smery) používa camelCase (`CamelModel` v `schemas/internal.py`). API z Fázy 1 sme nemenili, aby sa nerozbili hotové časti.
- **Dôsledok:** Frontend typy v `api/wms.ts` zodpovedajú JSON-u jedna k jednej. Zjednotenie starého API je možné vo Fáze 7.

## ADR-037 Verejná tabuľa ETA
- **Kontext:** Tabuľa visí na obrazovkách v depe bez prihlásenia a bez ovládania.
- **Rozhodnutie:**
  - `/board?key=<BOARD_KEY>` číta `GET /api/board?key=…`. Kľúč sa porovnáva v konštantnom čase, prázdny `BOARD_KEY` tabuľu vypne a platí limit 120 požiadaviek za minútu.
  - Tabuľa nemá WebSocket (bez prihlásenia nie je ticket), obnovuje sa každých 10 s.
  - Ukazuje príchody a odchody dňa (a neukončené jazdy z predošlého dňa), meškania, kaskádové varovania a stav linky.
  - Je vždy tmavá a s veľkým písmom bez ohľadu na tému, kvôli čitateľnosti z diaľky.
- **Dôsledok:** Kľúč je zdieľané tajomstvo, nie identita používateľa. Pri úniku stačí zmeniť `BOARD_KEY`.

## ADR-038 Offline cestná sieť a adresy z OpenStreetMap
- **Kontext:** Vozidlá majú jazdiť po skutočných cestách a balíky mať reálne adresy. Zadanie zakazuje externé routing API a simulátor musí zostať deterministický, takže za behu nesmie volať internet.
- **Rozhodnutie:**
  - Jednorazový skript `tools/osm/build_osm_data.py` spracuje výrez Slovenska z Geofabriku (pyosmium v kontajneri, postup v `tools/osm/README.md`). Vyrobí **cestný graf** `telematics/data/roads.json.gz` (hlavné cesty SR a všetky ulice okolia Košíc a Budimíra, 52 tisíc uzlov, 1 MB) a **adresné body** `app/.../seed/data/addresses.json.gz` (25 tisíc v Košiciach a 3–6 tisíc v každom cieľovom meste). Oboje je v gite.
  - Telematika hľadá trasy **A\*** s časom jazdy podľa triedy cesty (`simulator/roads.ts`) a výsledky si cachuje. Čas jazdy a rýchlosť na mape vychádzajú z trasy.
  - Seed vyberá adresy balíkov z adresných bodov cez seedovaný generátor. Rajón KE-01 až KE-08 sa určí podľa polohy adresy.
  - Overpass API bolo pri vývoji preťažené, preto sa používa stiahnutý výrez, čo je navyše reprodukovateľné.
- **Dôsledok:** Trasa Budimír → Bratislava hub má 423 km a 5,1 h po D1. Žiadne volanie siete za behu, determinizmus z Fázy 2 platí naďalej (rovnaký graf = rovnaká trasa). Dáta sú © OpenStreetMap contributors (ODbL), atribúcia je v UI aj v README. Bez súboru s grafom (unit testy) sa použijú náhradné polylíny z `data/routes.json`.

## ADR-039 Viac skladov: depo Budimír a hub Bratislava
- **Kontext:** Depo nie je v Košiciach, ale v **Budimíri** pri Košiciach. Diaľkové kamióny končia v ďalšom sklade a dátový model má podporovať viac skladov.
- **Rozhodnutie:**
  - Nová tabuľka `depots` (id, code, name, kind `depot | hub`, lat, lon, layout JSONB).
  - `depot_id` pribudol na `directions`, `doors`, `trips`, `waves` a `vehicles` (domovské depo). V db-telemetry pribudol `devices.depot_code`. Smer má cieľ (`dest_lat`, `dest_lon`) a pri BA aj `destination_depot_id` (hub).
  - Migrácia vytvorí oba sklady a existujúce dáta priradí k BUD.
  - **BUD (Budimír)** je plne simulovaný. Poloha je zatiaľ v priemyselnej zóne Budimíra (48.79256, 21.30710, sklad 138 m z OSM) a tím ju spresní úpravou `depots.lat/lon`.
  - **BAH (Bratislava hub)** je cieľ diaľkových kamiónov BA. Má 6 rámp a na mape ukazuje kamióny na ceste, na mieste a pri odchode. Nakládka a IoT skenery sa simulujú len v BUD.
  - `layout` popisuje halu (rozmery, natočenie, pás, vjazd). Rovnaké dáta používa 3D model na mape aj `/shadow` (`GET /api/layout?depot=…`). Živý stav: `GET /api/depots/{code}/state`.
- **Dôsledok:** Ďalší sklad pribudne ako riadok v `depots` s bránami a rozložením. Kamióny aj kuriéri (Fáza 4) vyrážajú z Budimíra. Kódy brán sú unikátne globálne (hub má `BA-R01…`).

## ADR-040 Mapy: MapLibre GL + OpenFreeMap, 3D sklady cez Three.js
- **Kontext:** Leaflet s rastrovými dlaždicami nevie 3D budovy, náklon ani vlastnú WebGL vrstvu. Tím chce mapu v štýle referencie s 3D halou depa.
- **Rozhodnutie:**
  - Mapový podklad je **MapLibre GL 6** so svetlým vektorovým štýlom **OpenFreeMap Positron** (bez API kľúča). Predvolený náklon je ~45° a 3D budovy sa kreslia z vrstvy `building`.
  - Spoločný komponent `components/map/MapView` používa Flotila a neskôr aj `/track` a `/courier`.
  - Vlastné piny podľa referencie: zaoblený pin s ikonou vozidla, farba podľa stavu a meškania. Trasa vybraného vozidla je farebná čiara po reálnej ceste. Klik na vozidlo spustí plynulý prelet kamery a otvorí bočný panel.
  - Sklady sú **custom layer s Three.js** (`components/map/depot3d.ts`). Pri priblížení (zoom ≥ 15) sa zobrazí hala z rozloženia: pás, brány, kamióny pri obsadených bránach, kopy balíkov na plochách a IoT piny so stavom. Pri oddialení sa zobrazí výrazná 3D značka skladu. Klik na sklad otvorí `/shadow?depot=…`.
  - Atribúcia „OpenFreeMap © OpenMapTiles, © OpenStreetMap contributors“ je na mape aj v README.
  - Mapové stránky sa načítavajú lenivo (MapLibre + Three.js ~1,6 MB), takže hlavný balík zostáva ~300 kB. Worker MapLibre zbundluje Vite.
- **Dôsledok:** Podklad mapy potrebuje v prehliadači internet (dlaždice OpenFreeMap). Simulátor a backendy ho nepotrebujú. Pre obhajobu bez internetu je vo Fáze 7 naplánovaný offline výrez **PMTiles** servírovaný z app (počet kontajnerov sa nezmení). Bez WebGL zobrazí mapa zrozumiteľnú hlášku.

## ADR-041 Kuriérske trasy: deň doručenia, rajóny a simulácia jazdy
- **Kontext:** Zadanie: kuriéri ráno dostanú zoradené zastávky (nearest neighbor od depa), pohybujú sa medzi nimi, na každej zastavia 2–6 min a 90 % doručení je úspešných. Treba určiť, kedy trasa vzniká, kto ju jazdí a kto hlási výsledky.
- **Rozhodnutie:**
  - **Trasu vytvára app** (`services/couriers.py`) pri príprave prevádzkového dňa D (krok `couriers:D`). Patria do nej balíky rajónu z dňa D a jazdí sa **ráno D+1** (`courier_routes.date = D+1`), teda ešte v rámci prevádzkového dňa D (do 15:00). Pevné priradenie: `kurier0N` → rajón `KE-0N` → dodávka `KE-30NKR` → odstavná plocha `SB-0N`.
  - Poradie zastávok určuje **nearest neighbor od depa Budimír**. Plánované ETA v app je hrubý odhad (vzdušná čiara × 1,35 pri 28 km/h + 4 min na zastávku).
  - **Rajóny sú vyvážené podľa hustoty adries.** Pôvodné 45° výseky dávali jednému kuriérovi 40 a inému 123 zastávok. Hranice výsekov sú teraz kvantily azimutov košických adresných bodov, takže každý rajón má rovnaký počet adries. Platí pre balíky nových dní, už vygenerované dni sa nemenia.
  - **Jazdu simuluje telematika** (`simulator/couriers.ts`, čistá funkcia ako scenár): nakládka od ~7:00 (sken každého balíka do dodávky), odchod ~7:30, jazda po **uliciach z offline grafu (A\*)**, na zastávke 2–6 min (priemer ~2,7 min), 90 % úspešných, návrat do depa. Seed je rovnaký ako pri kamiónoch, takže rovnaký seed = rovnaký deň kuriérov.
  - Udalosti `loaded`, `departed`, `delivered`, `failed`, `returned` a predikcie ETA idú do app cez `POST /internal/events/couriers`. Posielajú sa **aj pri skoku hodín**, lebo menia stav balíkov (na rozdiel od skenov, ADR-025). Chyba predikcie ETA sa zmenšuje, ako sa dodávka blíži.
  - Kuriér môže zastávku uzavrieť ručne na `/courier`. **Platí prvý výsledok**: neskoršia udalosť zo simulátora pre už uzavretú zastávku sa ignoruje.
  - Nezastihnutý balík ostáva `failed_delivery`. Opakované doručenie ďalší deň nie je v rozsahu prototypu.
- **Dôsledok:** Najväčšie rajóny sa vracajú okolo 14:00–15:00, čo zodpovedá zadaniu (kuriéri sa vracajú zo zvozu do 15:30). Reštart dňa (ADR-033) vráti aj trasy do plánovaného stavu a zmaže odkazy a SMS.

## ADR-042 Sledovanie zásielky: životný cyklus tokenu a súkromie *(upravené pred Fázou 5)*
- **Kontext:** Zadanie 6: token pri naskenovaní do dodávky, verejný endpoint s rate limitom, súkromie vynútené na serveri, zneplatnenie po doručení a tvrdá expirácia na konci dňa.
- **Rozhodnutie:**
  - Pri udalosti `loaded` vznikne `secrets.token_urlsafe(32)`. V `tracking_tokens` je len SHA-256 a SMS v `customer_notifications` nesie celý odkaz (ADR-010). Telefónne číslo je simulované. Do logu ide len informácia o odoslaní, **token v logu nie je**.
  - Platnosť končí o **polnoci dňa doručenia podľa simulovaného času** (simulátor vlastní hodiny, ADR-022).
  - `GET /api/track/{token}`:
    - **rate limit v dvoch úrovniach** (`core/ratelimit.py`, knižnica `limits`, ktorú už prináša slowapi; posuvné okno v pamäti):
      - platný odkaz: `TRACK_TOKEN_RATE_LIMIT` = **60/min na token** (kľúč je SHA-256 tokenu). Stránka sa pýta každých 5 s (12/min na okno), takže jeden odkaz zvládne ~5 okien a rôzne odkazy za jednou IP sa navzájom neobmedzujú,
      - neúspešné vyhľadanie (neznámy, expirovaný alebo zrušený odkaz): `TRACK_MISS_RATE_LIMIT` = **10/min na IP** ako ochrana proti hádaniu,
      - IP nad limitom neúspechov dostane 429 pre každý token, aj platný, aby sa limit nedal použiť na zistenie, ktoré tokeny existujú,
      - za reverznou proxy sa IP berie z `X-Forwarded-For`: uvicorn beží s `--proxy-headers` a verí len adresám z `FORWARDED_ALLOW_IPS` (predvolene `127.0.0.1`, teda žiadnej proxy). Uvádza sa **len presná IP proxy**, nie celý rozsah docker sietí (napr. `172.16.0.0/12`), lebo cez bránu docker siete prichádzajú aj priame požiadavky na publikovaný port a hlavička by sa dala podvrhnúť. Za proxy sa port app nepublikuje,
      - pôvodný limit 30/min na IP zhodil demo pri 3 otvorených oknách, lebo v Dockeri sú všetci klienti jedna IP,
    - formát tokenu sa overí regexom (inak 422),
    - neznámy, expirovaný aj zrušený odkaz dostane rovnakú odpoveď 404 bez rozlíšenia dôvodu,
    - hlavičky `Cache-Control: no-store` a `Referrer-Policy: no-referrer` (aj na HTML stránke `/track/…`), aby token neodišiel cez Referer napr. na server dlaždíc mapy.
  - **Súkromie:**
    - presná poloha kuriéra len ak je zákazník **najviac 3. v poradí** (počítajú sa otvorené zastávky pred ním),
    - inak názov rajónu a kruh s polomerom 2 km, ktorého stred je poloha dodávky zaokrúhlená na mriežku 0,02° (kruh dodávku vždy obsahuje, ale nesleduje ju),
    - nikdy ostatné zastávky, ich adresy ani trasa,
    - meno kuriéra len krstné,
    - zákazník vidí len **vlastné** miesto doručenia.
  - Po doručení endpoint vráti len `{status, barcode, deliveredAt}`. Stránka ukáže „Doručené o HH:MM“ bez mapy.
- **Dôsledok:** Limity sú v pamäti jednej inštancie app (pri viacerých inštanciách by potrebovali Redis, čo by bol 5. kontajner). Ak niekto z IP depa skúša neplatné odkazy, na minútu zablokuje sledovanie aj ostatným za tou istou IP. Kontrola a zápis neúspechu nie sú atomické, takže súbežné požiadavky prejdú o pár pokusov viac; pri 256-bitových tokenoch je to bezvýznamné. `--proxy-headers` mení klientsku IP pre všetky limity (login, tabuľa) aj pre `sessions.ip`, nielen pre sledovanie. Knižnica `limits` je v `pyproject.toml` uvedená explicitne. Polohu dodávky si app pýta z telematiky (`GET /internal/vehicles/{plate}`, service token) a 2 s ju cachuje, aby veľa zákazníkov jedného kuriéra nezaťažilo telematiku.

## ADR-043 Obrazovka kuriéra a dodávky vo Flotile
- **Kontext:** ADR-011 sľubuje `/courier` vo Fáze 4. Dispečing potrebuje vidieť aj dodávky.
- **Rozhodnutie:**
  - `/courier` je mobile-first: ďalšia zastávka s veľkými tlačidlami „Doručené“ a „Nezastihnutý“, zoznam zastávok, hotové zastávky a mapa (rovnaký `MapView`).
  - Kuriér vidí len svoju trasu. Admin a dispečer si vyberú kuriéra (`?courier=kurier03`), ale **uzavrieť zastávku môže len kuriér trasy (a admin)**.
  - API: `GET /api/courier/route`, `GET /api/courier/routes`, `POST /api/courier/stops/{id}`.
  - Vo Flotile sa dodávky pohybujú a majú stav (nakladá / na trase / na zastávke / vracia sa). Vybraná dodávka ukáže zvyšok trasy po uliciach (`GET /routes/vehicle/:plate` v telematike, len pre staff, zákazník ju nikdy nedostane) a zoznam zostávajúcich zastávok.
- **Dôsledok:** Dispečer má `/courier` v menu ako náhľad. Tlačidlá vidí len kuriér a admin.

## ADR-044 Názov „Depot 5.0“, téma „Oranžová“ a prefix čiarových kódov
- **Kontext:** Tím chce projekt navonok prezentovať ako **Depot 5.0** a v UI nepoužívať názov SPS, aby prototyp nepôsobil ako produkt konkrétnej firmy. Proces depa ostáva podľa reálneho depa v Budimíri.
- **Rozhodnutie:**
  - UI, README, `docs/`, tituly OpenAPI (`Depot 5.0 API`, `Depot 5.0 Telematics API`) a text simulovanej SMS („Depot 5.0: Váš balík …“) používajú názov Depot 5.0. V kóde ostáva `depotrack` (balík, databázy, cookie, kľúč v `localStorage`), aby premenovanie nerozbilo dáta ani nasadenie.
  - Téma `sps` sa volá **`oranzova`** („Oranžová“). Uložená voľba `sps` v prehliadači sa číta ako predvolená téma, teda tiež Oranžová.
  - **Čiarové kódy nových dní majú prefix `DP`** (`DP261026…`, nočné `DP261026N…`). Už vygenerované dni v databáze si nechávajú `SPS…`, reštart dňa (ADR-033) ich pregeneruje s novým prefixom. Kód sa nikde nerozkladá podľa prefixu, kontrola smeru ide cez balík v DB.
  - Kontext SPS ostáva v `docs/PROMPT.md` (zadanie od učiteľa, opis reálneho procesu) a v starších ADR ako história.
- **Dôsledok:** Na obhajobe UI neukazuje cudziu značku. V databáze, ktorá vznikla pred touto zmenou, môžu byť balíky s oboma prefixmi naraz.

## ADR-045 Digitálny tieň namiesto digitálneho dvojčaťa
- **Kontext:** Garant predmetu vyhradzuje pojem **digitálne dvojča** pre systém, ktorý **priamo riadi fyzické zariadenia**. 3D pohľad Depot 5.0 realitu len zrkadlí a zasahuje do nej cez rozhodnutia človeka.
- **Rozhodnutie:**
  - Používame tri pojmy podľa smeru toku dát:

    | Pojem | Realita → model | Model → realita | V Depot 5.0 |
    | --- | --- | --- | --- |
    | **Digitálny model** | ručne (návrh, import) | nie | rozloženie haly v `depots.layout` |
    | **Digitálny tieň** | **automaticky** (skeny, polohy, stav zariadení cez WebSocket) | len cez **rozhodnutie človeka** vo WMS (presun jazdy, údržba, potvrdenie alarmu) | `/shadow` a 3D hala na mape |
    | **Digitálne dvojča** | automaticky | **automaticky**, príkazy priamo fyzickým zariadeniam | nie je, „ďalší rozvoj“ |

  - Premenované: route `/twin` → `/shadow`, priečinok `frontend/src/twin` → `src/shadow`, `TwinPage` → `ShadowPage`, menu „Digitálny tieň“, odkazy z mapy `/shadow?depot=…`, komentáre v kóde, `docs/` a `docs/PROMPT.md`. Stará adresa `/twin` sa nepresmerúva (bol to len zárodok stránky).
  - Scenáre what-if vo Fáze 5 pobežia v kópii simulácie a živé dáta nezmenia. Akcie zo scény pôjdu cez bežné API s RBAC, teda vždy ako rozhodnutie prihláseného človeka.
  - **Čo chýba k dvojčaťu (ďalší rozvoj):** priame príkazy fyzickým zariadeniam (napr. zastavenie alebo prestavenie triediaceho pásu, prepnutie výhybky k bráne, reštart skenera, otvorenie vjazdovej závory) cez riadiacu vrstvu (PLC/OPC UA, MQTT) s bezpečnostnými blokovaniami, potvrdením vykonania a auditom. Model by potom realitu nielen zrkadlil, ale aj automaticky riadil.
- **Dôsledok:** Terminológia v UI, kóde a dokumentácii zodpovedá tomu, čo systém naozaj robí. Na obhajobe vieme presne povedať, čo by k dvojčaťu ešte chýbalo.

## ADR-046 3D stack: React 19, React Three Fiber 9, drei 10, zustand (nie Next.js)
- **Kontext:** Fáza 5 stavia 3D scénu digitálneho tieňa. Zadanie (§7) uvádza React 18 a `@react-three/fiber` s `@react-three/drei`. Aktuálne verzie R3F 9 a drei 10 vyžadujú React 19. Staršie R3F 8 a drei 9 nemajú overenú kompatibilitu s three 0.186, ktoré už používa mapa. Zvažoval sa aj prechod na Next.js.
- **Rozhodnutie:**
  - **Upgrade na React 19** (`react`, `react-dom`, `@types/react*` 19) ako samostatný commit. Ostatné závislosti (react-router 7, TanStack Query 5, lucide-react) React 19 podporujú. Leaflet, ktorý verziu obmedzoval (ADR-032), z projektu zmizol vo Fáze 3b.
  - Pre `/shadow`: `@react-three/fiber` 9, `@react-three/drei` 10 (hotové `OrbitControls`, `Html`, `Instances`, `Bounds`, `ContactShadows`, `useGLTF`; čo sa nakoniec použilo, je v ADR-049) a `zustand` 5 na vysokofrekvenčné dáta z WebSocketu, ktoré scéna číta cez refy v `useFrame` bez re-renderu. Na analýzu bundlu `rollup-plugin-visualizer` (dev, podporuje rolldown z Vite 8).
  - **Ostávame pri React + Vite, nie Next.js:**
    - aplikácia je za loginom, SSR a SEO nemajú prínos,
    - 3D scéna (WebGL) sa na serveri nevyrenderuje,
    - frontend servíruje `app` ako statické súbory a Next.js server by bol 5. kontajner (povinná podmienka sú 4).
  - three.js a R3F sa načítajú len v lazy chunkoch (`React.lazy` pre `/shadow` a Flotilu). Overí to analýza bundlu.
- **Dôsledok:** Odchýlka od zadania (React 18 → 19). Kontrola po upgrade prešla bez chýb na všetkých obrazovkách pri 1280, 1440 a 390 px (admin, kuriér, tabuľa, sledovanie).

## ADR-047 Scenáre „čo ak“: prepočet dňa na kópii, spoločné prípady kaskády
- **Kontext:** Panel „Scenár“ v digitálnom tieni má ukázať, čo urobí zásah (meškanie jazdy, výpadok zariadenia, zmena čítanosti, druhý skener na bránu, presun jazdy na inú bránu). Výsledok má byť porovnanie KPI plán vs. scenár. Scenár nesmie zapisovať do živých dát a musí byť deterministický. Vzorec kaskády je v app (Python, živé varovania) a novo aj v telematike (scenár).
- **Rozhodnutie:**
  - **Žiadne druhé hodiny ani druhý simulátor.** Deň je čistá funkcia (plán, seed, manifesty, model čítanosti), ADR-023. Scenár (`telematics/src/simulator/whatif.ts`) ho prepočíta dvakrát tým istým kódom ako živý engine (`buildScenario` a `dayScans`): raz bez zásahov („plán“), raz so zásahmi („scenár“). Výsledok je okamžitý („zrýchlene“), počíta sa na kópiách a nič neposiela do DB, app ani WebSocketu.
  - **Zásahy:**
    - `delay` pridá minúty k príchodu alebo odchodu. Pri nočnom kamióne sa to pripočíta až po zaručenej poruche, aby ju nepohltila, a regionálne kamióny, ktoré naň čakajú, odídu neskôr.
    - `device_outage` znamená čítanosť 0: balíky sa spočítajú, ale neprečítajú.
    - `read_rate` nastaví pevnú čítanosť zariadenia.
    - `extra_scanner` znamená druhú kameru: 1 − (1 − r)².
    - `move_trip` presunie jazdu na inú bránu: skenuje ju skener tej brány. Ak je brána obsadená, kamión čaká na odchod predchádzajúceho a o 5 min ďalej (`DOOR_DELAY_MIN`).
  - **Horizont:** od teraz do konca prevádzkového dňa (15:00), nie do konca vlny. Kaskády vznikajú v noci, zásah sa robí večer (schválené s plánom Fázy 5). Do KPI idú len jazdy, ktoré ešte len majú prebehnúť.
  - **KPI:**
    - meškanie prechodov: súčet minút a počet oneskorených transitných odchodov,
    - kaskádové varovania: páry (prechod, nočný dodávateľ), ktoré sú podľa pravidla ohrozené,
    - neidentifikované balíky: spočítané a neprečítané,
    - zlé smery (a z toho neodhalené, ktoré skener neprečítal).
  - **Férové porovnanie:** zásah nesmie posunúť celú náhodnú postupnosť. Kód zdieľaný so scenárom preto ťahá náhodné čísla vždy rovnako, nezávisle od vstupov:
    - `facesRead` rovnako pri prečítanom aj neprečítanom štítku,
    - čakanie nočného balíka (`loadingScans`, `lineScans`) aj vtedy, keď ho netreba.
  - Zmena čítanosti potom nezmení, ktoré balíky skončia pri zlej bráne, a meškanie kamióna mení len časy. Testy to kontrolujú. Deň ostáva deterministický, len s inou postupnosťou ako pred Fázou 5.
  - **Kaskáda v dvoch jazykoch:** pravidlo je čistá funkcia `cascade_risk` (app) a `cascadeRisk` (telematika). Obe overuje rovnaký súbor prípadov [contracts/cascade-cases.json](../contracts/cascade-cases.json): `app/tests/test_cascade_contract.py` a `telematics/tests/cascade-contract.test.ts`. Kto zmení pravidlo, musí zmeniť JSON a obe implementácie, inak padne jeden z testov. Image `app` kopíruje `contracts/` kvôli testom.
  - API: `POST /sim/what-if` v telematike (ticket, dispečer a admin), najviac 10 zásahov. Telo validuje JSON schéma, neznáma jazda, brána alebo zariadenie vráti 400. Frontend volá telematiku priamo (ADR-027) a dotknuté brány a zariadenia zvýrazní v scéne.
- **Dôsledok:** Scenár používa simulovanú pravdu (skutočný príchod v simulácii), dashboard predikciu ETA, takže čísla sa môžu líšiť o chybu predikcie. Scenár nerieši kuriérske dodávky ani prebiehajúcu údržbu. Čísla scenára sú porovnateľné s plánom vďaka rovnakému seedu a rovnakým náhodným ťahom.

## ADR-048 Akcie WMS zo scény: presun jazdy, údržba zariadenia, potvrdenie alarmu
- **Kontext:** Tieň nesmie riadiť fyzické zariadenia (ADR-045), ale dispečer má zo scény rozhodovať. Rozhodnutie je bežná akcia WMS s RBAC.
- **Rozhodnutie:**
  - `PATCH /api/trips/{id}/door` (dispečer, admin):
    - len odchádzajúca jazda, ktorá ešte nenakladá (`planned`, `at_door`),
    - len nakladacia brána toho istého depa (inak 422),
    - konflikt (409), ak sa jej plánované okno prekrýva s inou neodídenou jazdou na tej bráne. Okno je od plánovaného príchodu (alebo 4 h pred odchodom) po plánovaný odchod.
    - Po zmene app zavolá `POST /internal/plan/reload` a telematika prepočíta budúce skeny: kamión skenuje skener novej brány. Ak telematika práve nebeží, app to zaloguje a zmenu telematika prevezme až pri ďalšom načítaní dňa.
    - Presun platí do reštartu dňa: reset (ADR-033) vráti jazdy na predvolenú bránu smeru, aby sa deň prehral rovnako a degradovaný skener pri BA mal čo skenovať.
    - Kontrola obsadenosti zamkne riadok brány (`SELECT … FOR UPDATE`), takže dva súčasné presuny na tú istú bránu neprejdú oba.
  - Údržba:
    - `POST /api/devices/{code}/maintenance` (dispečer, admin) založí záznam v novej tabuľke `maintenance_orders` (Alembic) a zavolá `POST /internal/devices/{code}/maintenance`,
    - zariadenie má na `minutes` simulovaných minút stav **`maintenance`** (v db-telemetry migrácia `005`, v scéne fialový pin) a neposiela skeny, nakládka sa medzitým sníma ručne. Potom je opravené. Stav sa mení len cez `monitorDevices`, takže alarmy offline zariadení ostanú konzistentné,
    - záznam sa uloží v tej istej transakcii, ale commitne sa až keď telematika potvrdí, inak 503 bez záznamu,
    - `restartDay` okná údržby zruší (sú v simulovanom čase), deň sa prehrá rovnako ako bez údržby,
    - `GET /api/maintenance` vidí aj ochranka.
  - **Oprava nezruší zaručenú degradáciu** (požiadavka pre Fázu 6): degradovaný skener je čistý do konca prevádzkového dňa a od 15:30 nasledujúceho dňa sa začne znova špiniť. `restartDay` ho vráti na začiatok dňa ako doteraz. To isté platí pre admin tlačidlo „opraviť“.
  - Potvrdenie alarmu používa existujúce `POST /api/alerts/{id}/ack`. V paneli kamióna je kaskádové varovanie, v paneli zariadenia jeho alarmy.
  - Frontend tlačidlá ukáže len dispečerovi a adminovi. O prístupe rozhoduje backend (ADR-017), testy majú maticu rolí.
- **Dôsledok:** Model → realita ide len cez človeka a auditovateľné API (log, `maintenance_orders`). Okno údržby si telematika drží v pamäti, reštart kontajnera ho zruší (zariadenie je hneď online). Počas údržby ostanú balíky nenaložené, kým ich operátor nenaskenuje ručne. To je zámerný dôsledok, ktorý sa dá ukázať.

## ADR-049 Spoločné 3D diely pre digitálny tieň a mapu, scéna v React Three Fiber
- **Kontext:** Zadanie chce jednu knižnicu 3D komponentov pre `/shadow` aj pre 3D halu na mape. Mapa je MapLibre custom layer v čistom three.js (ADR-040). Most R3F ↔ MapLibre (`react-three-map`) by vyžadoval prechod mapy na `react-map-gl`, alebo vlastný most cez R3F `createRoot`, ktorý zadanie nechce.
- **Rozhodnutie:**
  - **Spoločné diely sú v čistom three.js** v `frontend/src/shadow/parts.ts`: hala, dvor, pás s odbočkami, rám brány, odstavná plocha, kamión, auto, kopa balíkov, pin a značka skladu. Pozície berú len z `GET /api/layout` (`src/shadow/layout.ts`).
  - Mapa (`components/map/depot3d.ts`) ich skladá do custom layera. Tieň ich obaľuje do malých R3F komponentov (`Hall`, `Conveyor`, `Dock`, `StagingBay`, `Truck`, `DevicePin`, `ParcelFlow`, `YardCars`, `CameraRig`, `Highlight`) cez `<primitive>`. Tvar sa tak mení na jednom mieste.
  - Z drei používame `OrthographicCamera`, `OrbitControls` (len rotácia okolo zvislej osi, zoom s limitmi), `Bounds` (prispôsobenie výrezu), `Html` (piny a popisy brán), `Instances` (balíky na páse, pevný pool 300), `ContactShadows` a `Gltf` (voliteľné modely). `Detailed` (LOD) sa nepoužíva: pri ortografickej kamere sa vzdialenosť pri zoome nemení.
  - Živé dáta: kanál `devices` z telematiky (stav, skeny, prejazdy bránou) ide do **zustand** store (`src/shadow/store.ts`). Scéna ho číta cez `getState()` v `useFrame`, takže sken nespôsobí re-render. Panely sa prihlásia na odber len svojho výseku. Kamióny pri bránach, kopy a KPI prichádzajú z `GET /api/shadow/{depot}` každých 5 s.
  - **`frameloop="demand"`**: scéna sa prekreslí, len keď sa zmení store (a karta je viditeľná), pri pohybe kamery, alebo keď si snímku vyžiada animácia. `ParcelFlow` volá `invalidate()` každý frame, kým sa po páse hýbe aspoň jeden balík. Rovnako to robí prichádzajúci kamión a pulz pinu.
  - Nové API v app: `GET /api/shadow/{depot}`, `/api/shadow/doors/{code}`, `/api/shadow/parcels/{barcode}` (dispečer, ochranka, admin; bez mien a adries). V telematike: `GET /devices/{code}/metrics?hours=` (čítanosť po 10 minútach pre sparkline).
- **Dôsledok:** Mapa a tieň sa nemôžu tvarovo rozísť a mapa sa nemusela prepisovať. Interaktivita (klik, výber, zvýraznenie) je len v tieni, na mape ostáva klik na sklad.

## ADR-050 Vybavenie brán a dverový kontaktný senzor (Fáza 5c)
- **Kontext:** Skutočné depo má rôzne brány:
  - 2 hlavné kamiónové s elektrickou sekcionálnou bránou a vyrovnávacím mostíkom,
  - 3 na plošine s teleskopickým pásom,
  - ručné kuriérske brány na lanko.

  Tieň má ukazovať aj stav brány, ale nesmie ju ovládať (ADR-045).
- **Rozhodnutie:**
  - `doors.door_drive` (`electric` | `manual`) a `doors.dock_equipment` (`dock_leveler` | `telescopic_conveyor` | `none`), Alembic `d4e8a2b6c1f3`. Dočasné hodnoty sú v `seed/reference.py` (`DOOR_EQUIPMENT`) a v migrácii:
    - LD-01–02: mostík,
    - LD-03–05: teleskopický pás,
    - LD-06–08: bez vybavenia,
    - SB: ručné,
    - rampy hubu: mostík.

    Reálne rozloženie Budimíra ich nahradí len zmenou dát. `/api/layout` vracia `doorDrive` a `dockEquipment`.
  - **Dverový kontaktný senzor** (`door_sensor`, `DOOR-SNS-01…08` pri LD-01…08, db-telemetry `006`) je lacný retrofit. Simulátor z neho posiela na kanál `devices` udalosti `door` so stavom `open` / `closed` / `fault` a ich snapshot pri prihlásení na odber.
    - Kamión pri bráne je len vstup simulátora: odchod je otvorený od príchodu k bráne po odchod, príjazd od príchodu po vyloženie.
    - Raz za prevádzkový deň jeden senzor počas večernej vlny na 30–75 min vypadne (začne 17:30–20:45, vždy skončí do 22:00). Má vlastný náhodný prúd `rngFor(seed, deň, "door")`, takže skeny, jazdy ani kaskáda sa nezmenia.
  - **Zdrojom stavu brány v scéne aj v paneli je len senzor.** Stav sa nehádá podľa kamióna:
    - pri poruche je brána neutrálna (polopriesvitný panel) so štítkom „senzor – porucha“,
    - vypnutý senzor hlási `unknown` a offline senzor sa vo frontende berie rovnako, takže brána je neutrálna so štítkom „senzor – bez údajov“,
    - brána bez senzora (rampy hubu) alebo pred prvým údajom je neutrálna bez štítku,
    - stav brány a vybavenie ukazuje panel aj pri voľnej bráne.
  - Udalosť `door` má v hube vlastný kľúč `door:<kód>`, aby ju v tej istej dávke neprepísala udalosť `status` toho istého zariadenia.
  - Senzor nikdy neposiela skeny. Preto nie je v čítanosti (KPI z `loading_scans`), v `device_metrics_minutely` ani v dátach pre prediktívnu údržbu (Fáza 6, `gen-history.ts` má pevný zoznam skenerov). Pokrýva to `telematics/tests/doors.test.ts`.
  - 3D: mostík je doska v 1 m medzere medzi návesom a fasádou, teleskopický pás sa pri otvorenej bráne vysunie do návesu. Ručná brána je zatiaľ len údaj v paneli (kuriérske plochy SB nie sú v stene haly).
- **Dôsledok:** Model dát zodpovedá skutočnému depu a tieň ostáva tieňom: zobrazuje senzor, neriadi bránu. Stav brány sa dá ukázať aj počas poruchy senzora bez zavádzania.

## ADR-051 Hub v Ivanke pri Dunaji z OpenStreetMap
- **Kontext:** Diaľkové kamióny BA končia v hube prepravcu v Ivanke pri Dunaji. Doteraz bol hub schematická hala na odhadnutom mieste pri Bratislave (ADR-039).
- **Rozhodnutie:**
  - Skript `tools/osm/find_hub.py` (pyosmium, lokálny extrakt) hľadá v okolí Ivanky budovy a priemyselné plochy s „SPS“ alebo „Slovak Parcel Service“ v `name`, `operator` alebo `brand` a vypíše aj najväčšie sklady ako kandidátov.
  - Našiel sa práve jeden objekt: way `52070792`, `building=warehouse`, „Slovak Parcel Service | UPS“, stred 48,19404 / 17,22834, 167 × 54 m, dlhá strana ~94° od východu.
  - Hub `BAH` dostal názov **„Ivanka pri Dunaji“** (v UI s kontextom „hub Bratislava“, kód ostáva `BAH`), túto polohu a halu 167 × 54 × 12 m s `rotationDeg` 86,1 (v smere hodín od východu, ADR-040).
  - **Predpoklad, nie údaj z OSM:** 6 rámp na jednej dlhej strane. OSM rampy nemá, tím ich môže upraviť v dátach.
  - Riadok skladu vzniká v migráciách (`e652f4dbafdb`) a Alembic migrácia `e7f1c3a9b5d2` ho presúva spolu s rampami a cieľom smeru BA v existujúcich DB. Seed vytvára rampy z `HUB_RAMPS`. Konštanty `HUB_NAME`, `HUB_LAT/LON` a `HUB_LAYOUT` v `seed/reference.py` sú vzor, voči ktorému `test_depots.py` kontroluje databázu. Čistý klon (overené ručne) aj existujúca DB tak skončia rovnako.
  - Najbližší uzol offline cestnej siete je 245 m od hubu, trasa Budimír → hub existuje (`roads.test.ts`). Generátor histórie pre ML používa novú polohu.
- **Dôsledok:** Trasa Budimír → hub má 418 km a 5,0 h (predtým 423 km a 5,1 h, ADR-038). Simulácia ostáva deterministická. Náhradná polylínia BA v `telematics/data/routes.json` končí v novom bode. Ak sa budova v OSM zmení, stačí znova spustiť `find_hub.py` a upraviť konštanty aj migráciu.

## ADR-052 GLTF modely Kenney v digitálnom tieni (Fáza 5c)
- **Kontext:** Tieň mal kamióny, autá a balíky z jednoduchých kvádrov. ADR-049 počítalo s voliteľnými modelmi cez drei `Gltf` a PROMPT §7 chce, aby scéna predvolene fungovala bez nich. Tím chcel vernejšie modely, ale bez veľkého bundlu, bez straty 60 fps a bez licenčných rizík. Car Kit nemá ťahač s návesom.
- **Rozhodnutie:**
  - Modely sú z **Kenney Car Kit 3.1** (`delivery`, `sedan`, `suv`) a **Factory Kit 3.0** (`box-small`, `box-large`), oba **CC0**. Tím ich stiahol ručne (stránka má kontrolu proti botom), kity sú v `tools/kenney/` mimo gitu.
  - Vo `frontend/public/models/` sú len použité súbory (spolu ~0,65 MB). Každý kit má vlastný podpriečinok s vlastným `Textures/colormap.png`, lebo GLB odkazujú na textúru s rovnakým menom. `LICENSE.txt` má presný názov, verziu a URL kitu, `*.glb` je v `.gitattributes` ako binary.
  - `src/shadow/models.ts` je jediné miesto s cestami a mierkou (1 jednotka kitu ≠ 1 m: vozidlá ×1,7, balík ×1,3, krabica kôpky ×1,2).
  - **Krabice sú inštancie geometrie z GLTF**, nie klony: `useModelMesh` vytiahne prvú mesh modelu, geometriu zmenší a vycentruje (raz na model, všetky kôpky ju zdieľajú), a drei `Instances` ju vykreslí ako jeden `InstancedMesh` (pás najviac 300 balíkov, kôpky pri bránach a na odstavných plochách). Autá a dodávky (málo kusov) sú drei `Clone`, ktorý zdieľa geometriu aj materiály.
  - Každý GLTF diel je vo `WithModel` (error boundary + Suspense). Kým sa model načítava alebo keď súbor chýba, scéna ukáže pôvodný jednoduchý diel z `parts.ts`. Mapa (MapLibre) modely nepoužíva.
  - **Kamión ostáva vlastný diel** (`parts.ts`), lebo kit nemá súpravu v našej mierke a farbách témy.
  - **Kuriérske dodávky:** tieň sa prihlási aj na kanál `vehicles`. Dodávka v stave `loading` stojí pred južnou stenou pri svojej odstavnej ploche, inak v scéne nie je. Store sa mení len pri začatí alebo skončení nakládky, nie pri každej polohe.
- **Dôsledok:**
  - Mení ADR-049 v časti o modeloch: modely sú teraz predvolené (odchýlka od §7 schválená v plan-doplnky 5c-4). Scéna bez nich stále funguje, lebo fallback na jednoduché tvary ostáva.
  - GLTFLoader je v chunku `ShadowPage` (spolu so scénou v2 teraz 346 kB, gzip 108 kB), prihlasovacia stránka ani 2D obrazovky ho nesťahujú (docs/bundle.md).
  - Záťažový režim pri 1440 px má stále 60 fps.
  - Iný model sa dá vymeniť zmenou `models.ts` a súboru, bez zásahu do scény.

## ADR-053 Ovládanie času: skok „preskočiť“ a „pretočiť s dátami“, krok +N, čistý reset (Fáza 5d)
- **Kontext:**
  - Testovať konkrétnu situáciu znamenalo čakať na 15:00 alebo skočiť bez dát. Skok podľa ADR-025 negeneruje skeny, prejazdy ani merania za preskočený úsek.
  - Po dňoch testovania ostávali v systéme presuny jázd, údržba, vypnuté zariadenia, iný seed a stovky alarmov.
  - V ostrom režime nemá nikto hodinami hýbať.
- **Rozhodnutie:**
  - **Dva režimy skoku:** `POST /sim/clock/jump {to: "HH:MM", mode}` na ľubovoľný čas.
    - `mode=skip` (predvolený) je správanie z ADR-025.
    - `mode=replay` zavolá `Engine.advance(cieľ)`: po simulovaných minútach volá ten istý `step` ako živé hodiny. Skeny, prejazdy a merania idú do db-telemetry. Jazdy a skeny idú do app každých 10 simulovaných minút, aby app videl jazdu „nakladá“ pred jej skenmi a „odišla“ až po nich.
    - Počas replayu sa jednotlivé skeny a prejazdy neposielajú na WebSocket. Kanál `clock` ukazuje priebeh.
  - **Krok** `POST /sim/clock/step {minutes}` (UI +5 / +15 / +60) je **tá istá metóda** `advance`. Test overuje, že step 60 a replay o 60 min dajú rovnaké skeny a že replay dá rovnaké skeny, jazdy aj dáta pre app ako živé hodiny po minútach. Deň je predpočítaný, takže veľkosť kroku ho nemení (ADR-023).
  - Najdlhší replay je 24 h. Počas replayu odpovedajú zmeny hodín (skok, krok, reset, reštart dňa) kódom 409.
  - **Čistý reset** `POST /sim/reset`:
    - telematika: seed z `.env` (`SIM_RANDOM_SEED`), vypnuté zariadenia zapne a deň spustí od 15:00 (`restartDay` zruší údržbu, presuny jázd aj stav dverí),
    - app (`/internal/days/{deň}/reset?clean=true`): okrem resetu dňa (ADR-033) zmaže `maintenance_orders` dňa a otvorené alarmy starších dní **uzavrie** systémovo (`acknowledged_at` = začiatok dňa, bez používateľa), takže audit ostane.
    - Vložené incidenty pribudnú v kroku 3 (po odovzdaní).
  - **`SIM_CONTROLS_ENABLED`** (predvolene `true`, v ostrom režime `false`):
    - pri `false` vrátia všetky ovládacie endpointy telematiky (pauza, rýchlosť, skok, krok, seed, reštart, reset, zariadenia) **403**, aj so service tokenom,
    - `GET /sim/clock` vracia `controlsEnabled` a admin UI ovládanie skryje,
    - scenár „čo ak“ ostáva, lebo nič nezapisuje.
- **Meranie (6. 11. 2026, lokálna db-telemetry, seed 42, deň 2027-02-24):**

  | Úsek | Simulované | Reálne | z toho kroky (výpočet + db-telemetry) | odosielanie do app |
  | --- | --- | --- | --- | --- |
  | 15:00 → 18:30 | 210 min | 3,4 s | 2,3 s | 1,0 s |
  | 18:30 → 02:10 | 460 min | 5,6 s | 3,3 s | 2,2 s |
  | 02:10 → 10:00 | 470 min | 12,5 s | 3,7 s | 8,8 s |

  Úzke hrdlo pri lokálnej DB je ráno odosielanie do app (kuriérske udalosti, sledovanie a simulované SMS). Večer sú to kroky simulácie. Štartovacia snímka zatiaľ nie je potrebná. Pri db-telemetry v Azure treba zápisy počas replayu dávkovať (ADR-056).
- **Dôsledok:** Situácia sa dá pripraviť za pár sekúnd s nadväzujúcimi dátami a deň sa dá kedykoľvek vrátiť do čistého stavu. Replay blokuje hodiny, kým beží, a WebSocket klienti za ten čas dostanú len zmenu času.

## ADR-054 Situácie: pomenované deterministické štartovacie body (Fáza 5d)
- **Kontext:** Demo, screenshoty a testy potrebujú konkrétny stav dňa (špička, nočná kaskáda, ranné odchody…) za pár sekúnd a zakaždým rovnaký.
- **Rozhodnutie:**
  - **Definície** sú v `telematics/data/situations.json`: id, slovenský názov a popis, čas, seed a voliteľne `forceCascade` a `degradedDevice`.
  - **Situácie:**
    - `evening-peak` (18:30), `night-cascade` (02:10), `morning-departures` (05:45), `couriers-morning` (07:20), `off-wave` (10:00),
    - `calm-night` (23:30, `forceCascade: false`, v pláne bez kaskády, aby scenár „čo ak“ ukázal jej vznik),
    - `scanner-ld05` (20:30, degradovaný `DOCK-SCN-05` namiesto `DOCK-SCN-02`).
  - **Načítanie** `POST /sim/situations/{id}` (admin, `SIM_CONTROLS_ENABLED`) je čistý reset (ADR-053) s nastaveniami situácie, potom replay od 15:00 do jej času. `GET /sim/situations` vidí personál.
  - **API je v telematike, nie v app** (odchýlka od plánu 5d): telematika vlastní hodiny, seed aj prepínače scenára a admin UI ju už volá priamo s ticketom (ADR-027).
  - **Prepínače situácie** platia do ďalšieho čistého resetu a prežijú reštart kontajnera (`sim_state.situation`, `force_cascade`, migrácia `007`). Zmena `SIM_RANDOM_SEED` v `.env` ich zruší ako doteraz seed.
  - **Odkaz** `?situation=<id>` na ľubovoľnej stránke: prihlásený admin situáciu načíta (`SituationLoader`), parameter zmizne z URL a skripty čakajú na `[data-situation="loaded"]`. Iná rola dostane len upozornenie.
  - **Determinizmus** overujú testy (`situations.test.ts`): tá istá situácia na čistom aj na použitom engine (iný seed, 4 h behu) dá rovnaké skeny, dáta pre app aj KPI plánu. `calm-night` má v pláne 0 kaskád, `night-cascade` viac ako 0. Naživo dal `evening-peak` dvakrát za sebou rovnaký dashboard aj plán scenára.
- **Meranie (6. 11. 2026, lokálna DB):** `evening-peak` 4–6 s, `calm-night` 9 s, `night-cascade` 10 s vrátane resetu. Štartovacia snímka (cache) zatiaľ nie je potrebná.
- **Dôsledok:** Demo na obhajobe a screenshoty začnú zo známeho stavu jedným klikom alebo odkazom. Situácia prepíše aktuálny deň, preto sa v admine pýta potvrdenie.

## ADR-056 db-telemetry v Azure Database for PostgreSQL, lokálny kontajner ako záloha
- **Kontext:**
  - Učiteľ požaduje jednu databázu v Azure, druhú podľa výberu.
  - Zadanie (PROMPT §1) hovorí o presne 4 kontajneroch: 2 databázy a 2 backendy.
- **Rozhodnutie:**
  - **Do Azure ide db-telemetry**, nie db-wms:
    - telemetria je simulovaná a obnoviteľná (situácia ju pripraví za pár sekúnd),
    - neobsahuje osobné údaje zákazníkov (tie sú v db-wms),
    - zapisuje sa dávkami, takže znesie latenciu siete,
    - db-wms ostáva lokálne kvôli rýchlosti obrazoviek a testom (pytest potrebuje DB, ADR-015),
    - výpadok Azure nezastaví WMS: nakládka, kontrola smeru a dispečing bežia ďalej.
  - **Server:** Azure Database for PostgreSQL Flexible Server, Burstable B1ms, PostgreSQL 16, verejný prístup s firewallom na IP, TLS povinné. Server vytvára používateľ (portál alebo az CLI, README).
  - **Pripojenie:** telematika číta `TELEMETRY_DATABASE_URL`. Keď je nastavená, má prednosť pred `TELEMETRY_DB_HOST/…`.
    - `sslmode` sa z URL vyberie a prevedie na voľbu `ssl` pre node-postgres: `require` a `verify-*` overujú certifikát systémovými CA (Azure má verejné CA), `no-verify` len šifruje, `disable` bez TLS.
    - Host `*.postgres.database.azure.com` bez `sslmode` dostane TLS automaticky.
    - Hodnoty sú len v `.env`, v `.env.example` je placeholder.
  - **Migrácie:**
    - ten istý runner (ADR-012) beží pri štarte aj proti Azure,
    - SQL súbory nepoužívajú rozšírenia ani funkcie, ktoré Azure musí povoliť (`azure.extensions`), takže netreba nič nastavovať.
  - **Latencia:**
    - živé hodiny zapisujú po tikoch ako doteraz (tik čaká na predchádzajúci, simulovaný čas sa nezdrží),
    - replay a situácie (ADR-053) zbierajú riadky v `BufferedSink` a zapíšu ich raz za 10 simulovaných minút. Pri celom dni je to ~110 zápisov namiesto ~6 000,
    - minútové metriky sa v bufferi sčítajú, lebo jeden `INSERT … ON CONFLICT DO UPDATE` nesmie dvakrát zasiahnuť ten istý riadok.
  - **Záloha:** kontajner `db-telemetry` ostáva v compose profile `local`.
    - `COMPOSE_PROFILES=local` a prázdne `TELEMETRY_DATABASE_URL` dajú 4 kontajnery ako doteraz (offline demo, test z čistého klonu),
    - závislosť telematiky na ňom je `required: false`.
  - **`/health` telematiky** vracia `dbKind` (`azure` / `local` / `external`), `dbHost`, `dbSsl` a `dbLatencyMs`. Stránka `/system` ich zobrazí.
- **Dôsledok:**
  - Predvolený režim má 3 kontajnery a 1 spravovanú databázu v Azure. Je to vedomá odchýlka od „4 kontajnerov“ podľa novej požiadavky učiteľa, počet databáz ostáva 2.
  - Bez Azure (alebo pri výpadku internetu) sa prepne jednou zmenou v `.env`.
  - Nová Azure DB začína s prázdnym stavom simulátora, deň sa pripraví situáciou.
  - Azure účtuje server, kým beží, preto README ukazuje `az postgres flexible-server stop`.

## ADR-057 ML v app: scikit-learn, tréning v image app, artefakty v repozitári (Fáza 6)
- **Kontext:**
  - PROMPT §8 chce modely v `app`, tréning v `ml/` a artefakty v `ml/artifacts/`.
  - Modely scikit-learn sa ukladajú ako pickle (joblib) a načítať ich vie spoľahlivo len tá istá verzia knižnice.
  - Telematika pozná odhad príchodu až počas jazdy. Pred odjazdom nemá tabuľa ETA čo ukázať okrem plánu.
- **Rozhodnutie:**
  - **Nové závislosti app:** `scikit-learn==1.9.1` (pevná verzia), `joblib`, `numpy`. Torch ani ťažké CV knižnice do image nepatria (ADR-013, CV v ďalších ADR).
  - **Tréning beží v image app** (`docker compose run … app python ml/train_delay.py`), takže verzia knižnice a kódovanie príznakov sú rovnaké ako pri inferencii. Kódovanie je jedno (`depotrack/ml/delay.py`) a importuje ho aj tréningový skript.
  - **Artefakty** (`*.joblib`, `*.onnx`) sú v gite ako binárne a do image ich kopíruje `Dockerfile` (`.dockerignore` púšťa len `ml/artifacts`).
    - Ak artefakt chýba alebo nesedí verzia scikit-learn, app naštartuje bez modelu, `GET /api/ml/status` vráti `available: false` a `/system` ukáže „model nedostupný“.
    - Načítavajú sa len vlastné artefakty z repozitára, nikdy súbory od používateľa (pickle je spustiteľný kód).
  - **Predikcia meškania:**
    - `HistGradientBoostingRegressor` (`loss=absolute_error`), MAE 6,14 min oproti 7,19 min pri baseline,
    - úloha `ml_job` v APScheduleri beží každých 5 reálnych sekúnd a koná, keď prejde 5 simulovaných minút,
    - plánovaným príjazdom doplní `predicted_arrival` s `trips.predicted_by = "ml"` (Alembic `f2a6c8e4d1b7`) a prepočíta kaskádu,
    - telematika (`predicted_by = "telematics"`) má prednosť a jej prázdny odhad ML neprepíše, kým jazda nepríde,
    - simulované počasie berie app z `GET /sim/scenario` (cache 30 s).
- **Dôsledok:**
  - Tabuľa ETA a kaskáda majú odhad aj pred odjazdom kamióna. Po pretrénovaní treba `docker compose build app`.
  - Image app je väčší o scikit-learn (~40 MB).
  - Model sa učí na simulovanej histórii (ml/README.md, obmedzenia).
