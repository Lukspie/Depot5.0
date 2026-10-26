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

## ADR-032 Témy SPS a Modrá, design systém vo `components/ui`
- **Kontext:** Tím chce farby, ako by systém používal prepravca SPS (oranžová, čierna, sivá), a zároveň vizuálny štýl referenčného dashboardu (ADR-021).
- **Rozhodnutie:**
  - Farby sú tokeny v `frontend/src/index.css` a prepínajú sa cez `<html data-theme>`. Predvolená je **`sps`**: primárna oranžová `#f39200`, čierna navigácia `#1d1d1b` a teplá sivá plocha. Druhá téma je **`modra`** podľa referencie. Prepínač je v hornej lište a voľba sa pamätá v prehliadači.
  - Stavové farby (ok/info/warn/danger/neutral) sú v oboch témach rovnaké. „warn“ je v SPS téme jantárová, aby sa neplietla s oranžovou značkou.
  - Text na oranžovom tlačidle je čierny (`on-brand`) kvôli kontrastu.
  - Logo SPS nepoužívame, DepoTrack má vlastnú značku.
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
- **Rozhodnutie:** KPI „Čítanosť“ na dispečingu a na tabuli je **podiel prečítaných štítkov zo všetkých položiek pri nakládke za prevádzkový deň** a počíta ju app z `loading_scans`. Stav zariadenia (online/degradované/offline) a krátkodobá čítanosť pre admin a dvojča zostávajú v telematike.
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
  - `layout` popisuje halu (rozmery, natočenie, pás, vjazd). Rovnaké dáta používa 3D model na mape aj `/twin` (`GET /api/layout?depot=…`). Živý stav: `GET /api/depots/{code}/state`.
- **Dôsledok:** Ďalší sklad pribudne ako riadok v `depots` s bránami a rozložením. Kamióny aj kuriéri (Fáza 4) vyrážajú z Budimíra. Kódy brán sú unikátne globálne (hub má `BA-R01…`).

## ADR-040 Mapy: MapLibre GL + OpenFreeMap, 3D sklady cez Three.js
- **Kontext:** Leaflet s rastrovými dlaždicami nevie 3D budovy, náklon ani vlastnú WebGL vrstvu. Tím chce mapu v štýle referencie s 3D halou depa.
- **Rozhodnutie:**
  - Mapový podklad je **MapLibre GL 6** so svetlým vektorovým štýlom **OpenFreeMap Positron** (bez API kľúča). Predvolený náklon je ~45° a 3D budovy sa kreslia z vrstvy `building`.
  - Spoločný komponent `components/map/MapView` používa Flotila a neskôr aj `/track` a `/courier`.
  - Vlastné piny podľa referencie: zaoblený pin s ikonou vozidla, farba podľa stavu a meškania. Trasa vybraného vozidla je farebná čiara po reálnej ceste. Klik na vozidlo spustí plynulý prelet kamery a otvorí bočný panel.
  - Sklady sú **custom layer s Three.js** (`components/map/depot3d.ts`). Pri priblížení (zoom ≥ 15) sa zobrazí hala z rozloženia: pás, brány, kamióny pri obsadených bránach, kopy balíkov na plochách a IoT piny so stavom. Pri oddialení sa zobrazí výrazná 3D značka skladu. Klik na sklad otvorí `/twin?depot=…`.
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

## ADR-042 Sledovanie zásielky: životný cyklus tokenu a súkromie
- **Kontext:** Zadanie 6: token pri naskenovaní do dodávky, verejný endpoint s rate limitom, súkromie vynútené na serveri, zneplatnenie po doručení a tvrdá expirácia na konci dňa.
- **Rozhodnutie:**
  - Pri udalosti `loaded` vznikne `secrets.token_urlsafe(32)`. V `tracking_tokens` je len SHA-256 a SMS v `customer_notifications` nesie celý odkaz (ADR-010). Telefónne číslo je simulované. Do logu ide len informácia o odoslaní, **token v logu nie je**.
  - Platnosť končí o **polnoci dňa doručenia podľa simulovaného času** (simulátor vlastní hodiny, ADR-022).
  - `GET /api/track/{token}`:
    - limit `TRACK_RATE_LIMIT` = 30/min na IP (slowapi),
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
- **Dôsledok:** Za reverznou proxy treba rate limit kľúčovať podľa `X-Forwarded-For` (v Docker deme sú všetci klienti jedna IP). Polohu dodávky si app pýta z telematiky (`GET /internal/vehicles/{plate}`, service token) a 2 s ju cachuje, aby veľa zákazníkov jedného kuriéra nezaťažilo telematiku.

## ADR-043 Obrazovka kuriéra a dodávky vo Flotile
- **Kontext:** ADR-011 sľubuje `/courier` vo Fáze 4. Dispečing potrebuje vidieť aj dodávky.
- **Rozhodnutie:**
  - `/courier` je mobile-first: ďalšia zastávka s veľkými tlačidlami „Doručené“ a „Nezastihnutý“, zoznam zastávok, hotové zastávky a mapa (rovnaký `MapView`).
  - Kuriér vidí len svoju trasu. Admin a dispečer si vyberú kuriéra (`?courier=kurier03`), ale **uzavrieť zastávku môže len kuriér trasy (a admin)**.
  - API: `GET /api/courier/route`, `GET /api/courier/routes`, `POST /api/courier/stops/{id}`.
  - Vo Flotile sa dodávky pohybujú a majú stav (nakladá / na trase / na zastávke / vracia sa). Vybraná dodávka ukáže zvyšok trasy po uliciach (`GET /routes/vehicle/:plate` v telematike, len pre staff, zákazník ju nikdy nedostane) a zoznam zostávajúcich zastávok.
- **Dôsledok:** Dispečer má `/courier` v menu ako náhľad. Tlačidlá vidí len kuriér a admin.
