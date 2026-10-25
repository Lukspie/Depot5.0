# DepoTrack – zadanie pre coding agenta

Si senior full-stack inžinier. Postavíš funkčný prototyp informačného systému **DepoTrack**: WMS pre prekládkové depo SPS (Slovak Parcel Service) v Košiciach. Je to školský tímový projekt na predmet AISPU (Architektúry informačných systémov a prediktívna údržba). Proces depa je reálny, všetky dáta sú simulované.

Pracuj **po fázach** (sekcia „Fázy“). Po každej fáze sa zastav, zhrň, čo si spravil, ako to overiť, a počkaj na potvrdenie. Na začiatku si celý dokument prečítaj a navrhni plán. Ak je niečo nejasné, zvoľ rozumný default a zapíš rozhodnutie do `docs/decisions.md` (krátke ADR: kontext, rozhodnutie, dôsledok).

---

## 1. Povinné podmienky od učiteľa (nesmú sa porušiť)

- Podnikový IS s prepojením aplikačných webových služieb.
- Prihlasovanie / odhlasovanie používateľov, **aspoň 2 role**, **sessions**.
- **Hlavný backend** obsluhuje **aspoň 2 obrazovky**. **Druhý backend v inom jazyku** (nemusí mať obrazovku).
- **Frontend spája oba backendy** (volá oba priamo).
- **Dve samostatné SQL databázy.**
- Nasadenie v Dockeri: **presne 4 kontajnery**: 2× databáza, 2× backend (rôzne jazyky), frontend servíruje jeden z backendov.
- Machine Learning časť.

Nepridávaj ďalšie kontajnery (žiadny Redis, MQTT broker, Nginx a pod.). Ak by si niečo také potreboval, navrhni alternatívu v rámci 4 kontajnerov a zapíš ADR.

---

## 2. Doména – ako depo funguje

Depo je **cross-dock**: balíky sa nepreskladňujú, len triedia a prekladajú. Triedi sa v dvoch vlnách.

**Typy smerov (`direction_type`):**
- `linehaul` – diaľkové kamióny: **BB, BA, ZA** (Banská Bystrica, Bratislava, Žilina)
- `transit` – „prechody“, regionálne kamióny: **Michalovce, Humenné, Stará Ľubovňa, Prešov, Poprad, Trebišov** (zoznam je konfigurovateľný)
- `local` – rajóny košických kuriérov: **KE-01 … KE-08**

**Denný cyklus:**
1. **Ráno:** prechodové kamióny odchádzajú do regiónov, košickí kuriéri si berú balíky z odstavných plôch a idú doručovať.
2. **Cez deň:** kuriéri doručujú a robia zvoz od firiem.
3. **Od 15:30 – večerná vlna:** vracajú sa kuriéri zo zvozu a prechodové kamióny so zásielkami z regiónov. Všetko ide na pás.
   - balíky pre `linehaul` → naložia sa, kamióny BB/BA/ZA odchádzajú večer
   - balíky pre `transit` a `local` → odstavia sa na plochy do rána
4. **1:00 – 6:00 – nočná/ranná vlna:** vracajú sa diaľkové kamióny s balíkmi pre východ. Balíky idú do prechodových kamiónov a ku košickým kuriérom. Diaľkové kamióny sú pripravené na ďalšie poobedie.

**Kľúčová závislosť (kaskáda meškania):** prechodový kamión môže odísť až keď sú vytriedené nočné diaľkové kamióny, ktoré ho dopĺňajú. Ak `predikovaný príchod nočného kamióna + triediaci buffer (default 30 min) > plánovaný odchod prechodu`, systém vyhlási varovanie.

**Problém so skenovaním (hlavná motivácia):** pri nakládke sa dnes skenuje ručným skenerom. Pri veľkom objeme to ľudia nestíhajú, takže dáta „balík je v kamióne“ sú nespoľahlivé. Skener na linke beží len v rannej vlne (balíky z kamiónov ležia štítkom hore). Poobede idú balíky na pás náhodne otočené. **Riešenie v DepoTrack:** IoT skenery (kamery) na konci pásu pri každej nakládkovej bráne. Automaticky čítajú štítok z viacerých strán, **počítajú balíky aj bez prečítania štítku** a systém porovnáva naskenované s očakávaným.

**Stavy balíka (`parcel_status`):**
`collected` → `on_belt` → `sorted` (priradený smer) → `loaded` (v kamióne) | `staged` (na odstavnej ploche) → `out_for_delivery` (v dodávke) → `delivered` | `failed_delivery` | `returned`

---

## 3. Architektúra

```
frontend (React, servírovaný z app)
   ├── REST + session cookie ──► app (Python FastAPI) ──► db-wms (PostgreSQL)
   └── WebSocket (ticket) ─────► telematics (Node.js TS) ──► db-telemetry (PostgreSQL)
app ◄──── REST (service token) ────► telematics
```

### Kontajnery (`docker-compose.yml`)
| Služba | Technológia | Úloha |
| --- | --- | --- |
| `app` | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2 | Hlavný backend: auth, sessions, RBAC, balíky, smery, jazdy, nakládky, tokeny, ML inferencia. Multi-stage build zostaví frontend a servíruje ho ako statické súbory. |
| `telematics` | Node.js 20, TypeScript, Fastify, `ws`, `pg` | Simulátor (vozidlá, GPS, IoT skenery, brána, linka), simulované hodiny, výpočet ETA, WebSocket stream udalostí, ukladanie telemetrie. |
| `db-wms` | PostgreSQL 16 | Obchodné dáta. |
| `db-telemetry` | PostgreSQL 16 | GPS, udalosti zariadení, prejazdy bránou, senzory. |

Healthchecky na všetkých službách, `depends_on: condition: service_healthy`. Všetko konfigurovateľné cez `.env` (commitni len `.env.example`).

### Komunikácia a bezpečnosť
- **Interné sessions:** server-side tabuľka `sessions` v db-wms, HttpOnly + SameSite=Strict cookie, expirácia 8 h (dĺžka smeny), logout session zmaže. Heslá cez argon2 alebo bcrypt.
- **RBAC:** FastAPI dependency `require_role(...)`. Role: `admin`, `dispatcher`, `operator`, `security`, `courier`.
- **WebSocket do telematiky:** frontend si od `app` vypýta krátkodobý **WS ticket** (JWT, 60 s, podpísaný zdieľaným tajomstvom, obsahuje rolu). Telematics ticket overí pri pripojení. Toto je bod „frontend spája oba backendy“ – zdokumentuj ho.
- **app ↔ telematics:** REST s hlavičkou `X-Service-Token`. Telematics posiela skeny a udalosti do `app` (`POST /internal/events/...`), `app` je zdroj pravdy pre balíky a jazdy.
- **Zákazník:** žiadny login. Viď sekcia 6.

### Simulované hodiny
Telematics vlastní simulovaný čas s násobiteľom (`SIM_SPEED`, default 60×) a štartovacím časom (default 15:00). Admin ich môže zastaviť, zrýchliť alebo preskočiť na „15:30 večerná vlna“ / „01:00 nočné kamióny“ / „06:00 ranné odchody“. Celý denný cyklus sa tak dá predviesť za pár minút. `app` si čas berie z telematiky.

---

## 4. Dátový model

### db-wms (Alembic migrácie)
- `users` (id, username, password_hash, full_name, role, active)
- `sessions` (id, user_id, created_at, expires_at, ip, user_agent)
- `directions` (id, code, name, type, cutoff_time, planned_departure, depends_on_linehaul[]) – pre `transit` zoznam diaľkových smerov, ktoré ho dopĺňajú
- `waves` (id, date, kind `evening|night`, starts_at, ends_at)
- `doors` (id, code, kind `loading_dock|staging_bay|yard_gate`, direction_id nullable, position_x, position_y) – pozície pre digitálne dvojča
- `vehicles` (id, plate, kind `truck|van`, capacity_kg, capacity_parcels)
- `trips` (id, vehicle_id, direction_id, door_id, kind `inbound|outbound`, planned_arrival, actual_arrival, predicted_arrival, planned_departure, actual_departure, status)
- `parcels` (id, barcode, weight_kg, length_cm, width_cm, height_cm, recipient_name, address, lat, lon, direction_id, status, sender)
- `parcel_events` (id, parcel_id, status, at, source `iot|manual|system`, door_id, trip_id, user_id) – časová os balíka
- `loading_scans` (id, parcel_id nullable, trip_id, door_id, device_id, at, result `ok|wrong_direction|unidentified|duplicate`)
- `courier_routes` (id, courier_user_id, vehicle_id, date, rajon_direction_id)
- `route_stops` (id, route_id, parcel_id, sequence, planned_eta, predicted_eta, delivered_at, outcome)
- `tracking_tokens` (id, token_hash SHA-256, parcel_id, created_at, expires_at, revoked_at)

### db-telemetry (SQL init skripty alebo node-pg-migrate)
- `devices` (id, code, kind `dock_scanner|line_scanner|gate_camera|line_sensor`, door_code, installed_at)
- `device_heartbeats` (device_id, at, status)
- `device_scan_events` (id, device_id, at, barcode nullable, read_ok, faces_read, item_counted)
- `device_metrics_minutely` (device_id, minute, items, reads_ok, read_rate) – agregácia pre prediktívnu údržbu
- `gps_positions` (vehicle_plate, at, lat, lon, speed_kmh, heading) – index na (vehicle_plate, at)
- `gate_passages` (id, at, direction `in|out`, vehicle_type, plate, plate_confidence, snapshot_path, expected)
- `line_sensor_readings` (at, sensor, value)

**GDPR:** naplánovaná úloha (APScheduler v `app` alebo časovač v telematike) maže `gate_passages` a snímky staršie ako `GATE_RETENTION_DAYS` (default 30).

### Seed (spustí sa automaticky pri prvom štarte)
- Používatelia pre každú rolu s dev heslami (vypíš ich do README, nie do kódu – prečítaj ich z `.env`).
- Všetky smery z sekcie 2, 8 nakládkových brán (BB, BA, ZA, Michalovce, Humenné, Stará Ľubovňa, Prešov, Poprad), 8 odstavných plôch kuriérov, 1 vjazdová brána.
- 12 kamiónov, 8 dodávok, ~1 500 balíkov na deň s realistickou hmotnosťou (lognormálne rozdelenie, väčšina 0,5–5 kg) a adresami v Košiciach (náhodné body v rámci mesta, priradené k rajónom KE-01…KE-08 podľa polohy).
- Zariadenia: skener pri každej nakládkovej bráne, skener na linke, kamera na vjazdovej bráne, 3 senzory linky.

---

## 5. Simulátor (v telematike)

- **Kamióny:** jazdy podľa denného cyklu. Trasy medzi Košicami a cieľovými mestami ako zjednodušené polylíny (súradnice miest + niekoľko medzibodov, uložené v JSON). Žiadne externé routing API. Poloha sa interpoluje podľa simulovaného času. Meškania sa generujú s náhodou a vzormi (piatok, december, zlé počasie).
- **Kuriéri:** ráno dostanú zoradené zastávky (nearest neighbor od depa), pohybujú sa medzi nimi, na každej zastavia 2–6 min. 90 % doručení úspešných.
- **IoT skenery pri nakládke:** počas vĺn generujú udalosti pre balíky priradené k smeru danej brány. Každý balík sa započíta (`item_counted=true`), štítok sa prečíta s pravdepodobnosťou `read_rate` (default 0,96, večer o niečo nižšie). Občas pošli balík do zlej brány (≈0,5 %) – musí vzniknúť alarm.
- **Scenár degradácie:** skener jednej brány (konfigurovateľne) postupne stráca čítanosť (napr. 0,97 → 0,85 za simulovaný deň). Toto má zachytiť model prediktívnej údržby.
- **Heartbeat** zariadení každých 10 s; zariadenie bez heartbeatu 30 s = `offline`. Admin môže zariadenie „vypnúť“ na demo.
- **Brána:** prejazdy kamiónov a dodávok podľa jázd + občas neočakávané osobné auto.
- **WebSocket kanály:** `vehicles` (polohy), `devices` (stav + skeny), `alerts`, `clock`. Klient sa prihlási na kanály, ktoré potrebuje. Udalosti posielaj v dávkach max. 4×/s, aby frontend nepreťažili.
- **Generátor histórie:** skript `npm run gen:history`, ktorý vygeneruje 6 mesiacov historických jázd a metrík zariadení do CSV pre trénovanie modelov.

---

## 6. Sledovanie pre zákazníka (token)

1. Keď sa balík naskenuje do dodávky kuriéra (`out_for_delivery`), `app` vygeneruje `secrets.token_urlsafe(32)`, do DB uloží iba SHA-256 hash a odkaz `/track/<token>` „pošle“ zákazníkovi (zápis do logu a do tabuľky simulovaných notifikácií viditeľnej v admine).
2. Verejný endpoint `GET /api/track/{token}` (rate limit napr. 30/min na IP, `slowapi`) vráti: stav, ETA okno, poradie zastávky („ste 4. v poradí“), polohu kuriéra.
3. **Súkromie sa vynucuje na serveri:** presná poloha kuriéra len ak je zákazník ≤ 3 zastávky v poradí. Inak len názov rajónu a približný kruh. Nikdy nevracaj ostatné zastávky ani ich adresy. Meno kuriéra len krstné.
4. Sken `delivered` token zneplatní (`revoked_at`). Stránka potom ukáže len „Doručené o HH:MM“, bez mapy. Tvrdá expirácia na konci dňa.
5. Stránka sa obnovuje polovaním každých 5 s (nepoužíva WebSocket – zákazník nemá ticket).

---

## 7. Frontend

React 18 + Vite + TypeScript, React Router, TanStack Query, Tailwind CSS. Mapy: Leaflet (react-leaflet) s OSM dlaždicami. 3D: three + @react-three/fiber + @react-three/drei.
**Všetky texty v UI po slovensky**, kód a identifikátory po anglicky. Čistý, moderný vzhľad: svetlá téma, pastelové farby, zaoblené karty, jemné tiene.

### Obrazovky
| Cesta | Rola | Obsah |
| --- | --- | --- |
| `/login` | všetci interní | prihlásenie, chybové hlášky |
| `/` Dispečerský dashboard | dispatcher, admin | aktuálna vlna, simulovaný čas, KPI, počty balíkov po smeroch, naplnenosť jázd, zoznam alarmov |
| `/twin` **Digitálne dvojča** | dispatcher, admin, security | hlavná „wow“ obrazovka, viď nižšie |
| `/fleet` Flotila | dispatcher | Leaflet mapa dodávok a kamiónov; klik na vozidlo → panel: zoznam balíkov so stavom, súčet hmotnosti voči nosnosti (progress bar), zostávajúce zastávky, meškanie |
| `/board` Tabuľa ETA | verejná v sieti depa (bez ovládania, bez loginu, len čítanie, prístup cez `BOARD_KEY` v URL) | celá obrazovka, veľké písmo, príchody/odchody kamiónov, meškania, varovania kaskády, stav linky; automatická obnova |
| `/loading` Nakládka | operator | výber brány, živý feed IoT skenov, počítadlá (prečítané / spočítané / neidentifikované), výrazný červený alarm pri zlom smere, ručné pole pre sken (simulácia ručného skenera), zoznam balíkov ešte chýbajúcich v jazde |
| `/gate` Brána | security | zoznam prejazdov (snímka, typ vozidla, ŠPZ, istota, očakávané áno/nie), upload obrázka na detekciu |
| `/parcels/:id` | dispatcher, admin | detail a časová os stavov balíka |
| `/admin` | admin | používatelia a roly, smery, zariadenia, ovládanie simulovaných hodín a scenárov, simulované notifikácie zákazníkom |
| `/track/:token` | zákazník (verejná) | mapa, ETA, poradie, stav; mobile-first |

### Digitálne dvojča (`/twin`) – detailná špecifikácia
Inšpirácia: izometrické 3D dashboardy skladov (svetlé pozadie, pastelová low-poly scéna, piny nad objektmi, plávajúce panely).

- **Kamera:** `OrthographicCamera` v izometrickom uhle (napr. pozícia `[60, 60, 60]`, pohľad na stred). `OrbitControls` len rotácia okolo osi Y, zoom s limitmi, bez prevrátenia.
- **Scéna z dát:** rozloženie z `GET /api/layout` (brány, plochy, pás, vjazd s pozíciami). Nič nehardcoduj v komponentoch.
  - hala (podlaha, nízke steny, strecha vynechaná alebo priehľadná)
  - hlavný triediaci pás cez halu, odbočky k nakládkovým bránam
  - nakládkové brány na jednej strane, pri obsadenej bráne kamión (kabína + náves z kvádrov, farba podľa typu smeru) s popiskom smeru
  - odstavné plochy kuriérov na druhej strane, kopy balíkov úmerné počtu odstavených balíkov
  - dvor a vjazdová brána s rampou, vozidlá na dvore podľa prejazdov
- **Vzhľad:** primitívne geometrie s `meshStandardMaterial`, pastelová paleta, mäkké svetlá (hemisphere + directional s tieňmi), `ContactShadows`. Priprav jednoduchý mechanizmus na výmenu primitív za GLTF modely v `frontend/public/models/` (napr. CC0 balíky z Kenney.nl), ale predvolene funguj bez nich.
- **Animácie:** pri každom skene sa po páse k danej bráne posunie malý balík (`InstancedMesh`, max. 300 naraz). Kamión sa pri príchode/odchode plynulo presunie.
- **IoT piny:** `Html` z drei nad každým zariadením. Farba: zelená `online`, oranžová `degraded` (čítanosť pod prahom alebo anomália z ML), červená `offline`. Jemná pulzácia pri novom skene.
- **Pravý panel po kliknutí:**
  - zariadenie: posledných 20 skenov naživo, čítanosť za smenu, počet spočítaných/prečítaných/neidentifikovaných, sparkline čítanosti za posledné hodiny, skóre rizika poruchy z modelu
  - kamión: smer, naplnenosť (ks aj kg voči kapacite), chýbajúce balíky (priradené, ale neprešli bránou), alarmy zlého smeru, plánovaný odchod, kaskádové varovanie
- **Horná lišta KPI:** balíky v aktuálnej vlne, kamióny v areáli, priemerná čítanosť, neidentifikované, aktívne alarmy, simulovaný čas.
- **Spodný panel:** vyhľadanie balíka podľa čiarového kódu → horizontálna časová os stavov; balík sa v scéne zvýrazní, ak je fyzicky v hale.
- **Výkon:** 60 fps na bežnom notebooku, žiadne alokácie v `useFrame`, zoskupovanie aktualizácií z WebSocketu.

---

## 8. Machine Learning (v `app`, tréning v `ml/`)

Tréningové skripty a notebooky v `ml/`, natrénované artefakty v `ml/artifacts/` (načítané pri štarte `app`). Ku každému modelu krátky `ml/README.md`: dáta, príznaky, metriky, obmedzenia.

1. **Detekcia vozidiel na bráne (CV):** Ultralytics YOLO (predtrénovaný `yolov8n` alebo novší, triedy car/truck/bus) + detekcia a OCR ŠPZ (napr. EasyOCR; slovenský formát ŠPZ over regexom). Endpoint `POST /api/gate/detect` (obrázok → typ, ŠPZ, istota, uložené ako prejazd cez telematics) a skript `ml/gate_video.py`, ktorý spracuje video súbor a posiela prejazdy. Použi CPU verziu PyTorchu, aby obraz nebol zbytočne veľký.
2. **Čítanie štítkov a počítanie balíkov (CV, prototyp IoT skenera):** skript `ml/dock_scanner.py`: z videa/webkamery detekuje a počíta krabice (YOLO, prípadne doladený na vlastných snímkach) a dekóduje čiarové/QR kódy (`pyzbar`). Výstup posiela ako `device_scan_events` rovnakým API ako simulátor. Takto sa dá na obhajobe predviesť reálny „IoT skener“ s telefónom a krabicami.
3. **Predikcia meškania kamiónov (tabuľková regresia):** gradient boosting (scikit-learn `HistGradientBoostingRegressor` alebo LightGBM) na histórii z generátora. Príznaky: smer, deň v týždni, hodina odchodu, mesiac/sezóna, počasie (simulované), meškanie predchádzajúcej jazdy. Výstup: `predicted_arrival` → vstup pre tabuľu ETA a kaskádové varovania. Metrika MAE v minútach voči baseline (priemer meškania na smer).
4. **Prediktívna údržba skenerov (anomálie):** `IsolationForest` nad `device_metrics_minutely` (čítanosť, počet položiek, trend za posledné okno). Úloha v `app` každých 5 simulovaných minút prepočíta skóre rizika a pri prekročení prahu vytvorí alarm „Skener brány X – klesajúca čítanosť, skontrolovať optiku“. Scenár degradácie zo simulátora musí byť zachytený.

---

## 9. Štruktúra repozitára

```
depotrack/
  docker-compose.yml
  .env.example
  README.md                 # spustenie, prihlasovacie údaje, demo scenár
  app/                      # Python FastAPI
    Dockerfile              # multi-stage: build frontendu + Python runtime
    pyproject.toml
    src/depotrack/
      main.py
      api/                  # routery podľa domén
      core/                 # config, security, sessions, rbac
      models/               # SQLAlchemy
      schemas/              # Pydantic
      services/             # doménová logika (kaskáda, tokeny, nakládka)
      ml/                   # inferencia
      jobs/                 # plánované úlohy
    alembic/
    tests/
  telematics/               # Node.js TypeScript
    Dockerfile
    src/{clock,simulator,ws,api,db}/
    sql/                    # init schéma db-telemetry
    data/routes.json
    tests/
  frontend/                 # React + Vite + TS
    src/{pages,components,twin,api,hooks}/
  ml/                       # tréning, notebooky, artefakty
  docs/
    architektura.md
    api.md
    decisions.md
    demo.md                 # krok za krokom scenár obhajoby
```

---

## 10. Fázy

Po každej fáze: `docker compose up --build` z čistého klonu musí prejsť, testy zelené, commit so zrozumiteľnou správou, krátke zhrnutie pre mňa.

- **Fáza 0 – kostra:** repozitár, 4 kontajnery s healthcheckmi, „hello“ endpointy oboch backendov, frontend servírovaný z `app`, README.
- **Fáza 1 – dáta a auth:** schémy oboch DB, migrácie, seed, login/logout, sessions, RBAC, `/admin` so správou používateľov.
- **Fáza 2 – telematika:** simulované hodiny, simulátor vozidiel a zariadení, WebSocket s ticketom, ukladanie telemetrie, REST medzi backendmi.
- **Fáza 3 – jadro WMS:** nakládka (IoT + ručné skeny, kontrola smeru, chýbajúce balíky), dashboard, tabuľa ETA s kaskádou, flotila s detailom vozidla, detail balíka.
- **Fáza 4 – zákazník:** tokeny, verejná stránka, súkromie, rate limit, zneplatnenie po doručení.
- **Fáza 5 – digitálne dvojča:** celá sekcia 7 `/twin`.
- **Fáza 6 – ML:** všetky 4 modely, ich napojenie do UI, `ml/README.md`.
- **Fáza 7 – dokončenie:** testy kritických ciest (auth, RBAC, token lifecycle, kontrola smeru, kaskáda), `docs/` (architektúra s diagramom, API, demo scenár), upratanie.

---

## 11. Pravidlá práce

- Drž sa 4 kontajnerov a zvoleného stacku. Nové závislosti len s odôvodnením.
- Žiadne tajomstvá v repozitári. Všetko z `.env`.
- Typy všade (mypy-friendly Python, strict TypeScript). Lint: ruff, eslint.
- API dokumentované cez OpenAPI (FastAPI automaticky; pre telematiku Fastify swagger).
- Chyby a prázdne stavy v UI riešené (načítavanie, žiadne dáta, výpadok WebSocketu s automatickým znovupripojením).
- Neimplementuj nič mimo rozsahu: 3D modelovanie mimo primitív, inventár/regálové skladovanie, fakturácia, reálne GPS zariadenia, odosielanie skutočných SMS/e-mailov.
- Ak niečo nejde podľa špecifikácie, povedz to otvorene a navrhni alternatívu, neobchádzaj to potichu.

Začni tým, že si prečítaš celý dokument, navrhneš plán Fázy 0 a 1 a počkáš na moje potvrdenie.
