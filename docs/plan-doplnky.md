# Doplnky k plánu (schválené tímom)

Rozšírenia a úpravy oproti [PROMPT.md](PROMPT.md). Odchýlky v návrhu sú zapísané aj ako ADR v [decisions.md](decisions.md).

## Fáza 2 – telematika (navyše k zadaniu)
- Simulátor je **deterministický**: pri rovnakom `SIM_RANDOM_SEED` sa deň odohrá rovnako (meškania, zlé smery, degradácia skenera). Seed sa nastavuje v `.env` aj cez admin API.
- V predvolenom seede je **zaručene** scenár degradácie skenera a aspoň jedno meškanie nočného kamióna, ktoré spôsobí kaskádové varovanie.
- Ovládanie hodín (pauza, rýchlosť, skok na 15:30 / 01:00 / 06:00) je API v telematike. UI v admine môže prísť vo Fáze 3.

## Fáza 3 – na začiatku: malý design systém *(hotové, pozri docs/design/komponenty.md)*
- Komponenty vo `frontend/src/components/ui`: `Badge`, `StatusDot`, `DataTable`, `Card`, `KpiCard`, `SidePanel`, `PageHeader`, `EmptyState`, `Spinner`.
- **Pravidlá:**
  - štítky a stavy sa nezalamujú (`whitespace-nowrap`), bodka a text stavu sú na jednom riadku,
  - tabuľky majú definované šírky stĺpcov a ellipsis,
  - layout sa kontroluje pri šírkach **1280, 1440 a 390 px**.
- Opraviť nimi aktuálne chyby v `/admin`:
  - zalomený štítok „Operátor nakládky“,
  - bodka a „Aktívny“ na dvoch riadkoch,
  - zalamujúce sa meno „(vy)“.
- Komponenty zdokumentovať v `docs/design/komponenty.md`.
- Témy: **Oranžová** (pôvodne „SPS“; oranžová, čierna, sivá – predvolená) a **Modrá** podľa referencie (ADR-032, ADR-044).
- Vizuálny cieľ je [docs/design/reference.png](design/reference.png) (popis v [docs/design/README.md](design/README.md)). Jeho štýl platí pre KPI karty, panely a celkovú paletu na všetkých obrazovkách, nielen v digitálnom tieni.

## Fáza 3b – mapa a sklady *(hotové, ADR-038 až 040)*
- MapLibre GL + OpenFreeMap (svetlý vektorový štýl, náklon ~45°, 3D budovy, vlastné piny, trasa vybraného vozidla, prelet kamery). Rovnaký komponent neskôr pre `/track` a `/courier`.
- Depo v **Budimíri**, hub v **Bratislave** (tabuľka `depots`, `depot_id` v dátovom modeli).
- 3D hala na mape (Three.js custom layer) z rovnakého rozloženia ako `/shadow`, klik na sklad otvorí `/shadow?depot=…`.
- Offline cestná sieť a reálne adresy z OSM, routing A* v telematike bez internetu za behu.

## Pred Fázou 5 (schválené spolu s Fázou 4, ADR-041 až 043 OK) *(hotové, ADR-042 upravené, ADR-044, ADR-045)*
1. **Rate limit `/api/track` – nová stratégia.** Pri limite na IP demo spadne pri 3 otvorených oknách (polling 12/min na okno).
   - Neplatný alebo neexistujúci token: prísny limit na IP (napr. 10/min) ako ochrana proti hádaniu.
   - Platný token: limit podľa tokenu (napr. 30/min), nie podľa IP.
   - Podpora forwarded hlavičiek pre nasadenie za proxy: `uvicorn --proxy-headers`, `forwarded-allow-ips` z `.env`.
   - Test: 5 súbežných klientov s platným tokenom nesmie dostať 429.
   - Upraviť ADR-042.
   - *Hotové:* 60/min na platný odkaz, 10/min neúspechov na IP, `FORWARDED_ALLOW_IPS`.
2. **Stav Fázy 3b:**
   - poslať screenshot `/fleet` s priblíženým Budimírom (3D hala na mape),
   - potvrdiť, že hub (druhý sklad) a `depot_id` v modeli sú hotové (podľa ADR-039 áno),
   - ak niečo chýba, dokončiť to ako prvé.
   - *Hotové:* hub BAH aj `depot_id` (directions, doors, trips, waves, vehicles) existujú, nič nechýba. Screenshot: [docs/screenshots/faza-3b/2-budimir-3d-hala.png](screenshots/faza-3b/2-budimir-3d-hala.png) (aktualizovaný).
3. **Premenovanie projektu na „Depot 5.0“** (v kóde môže ostať `depotrack`).
   - Upraviť UI, README a `docs/`.
   - Tému „SPS“ premenovať na neutrálnu **„Oranžová“** a v UI nepoužívať názov SPS.
   - Depo je „Budimír“.
   - *Hotové (ADR-044):* nové dni majú čiarové kódy s prefixom `DP`, SMS začína „Depot 5.0:“.
4. **Terminológia „digitálny tieň“ (digital shadow).** Pojem „digitálne dvojča / digital twin“ sa nepoužíva: garant ho vyžaduje len pre systém, ktorý priamo riadi fyzické zariadenia.
   - Tieň znamená: realita → model automaticky, model → realita len cez rozhodnutia človeka.
   - Premenovať v UI, kóde (`/twin` → `/shadow`, `src/twin` → `src/shadow`), dokumentácii, ADR a v `docs/PROMPT.md`.
   - V docs vysvetliť rozdiel **model / tieň / dvojča**. Uviesť, čo chýba k dvojčaťu (priame príkazy fyzickým zariadeniam) ako „ďalší rozvoj“.
   - *Hotové (ADR-045).*

## Fáza 5 – Digitálny tieň (`/shadow`) *(hotové, ADR-046 až 049, docs/fazy/faza-5-digitalny-tien.md)*
Podľa §7 zadania, plus nasledujúce rozšírenia.

**Schválené s plánom Fázy 5 (všetky odporúčania z otvorených otázok prijaté):**
- Commity po krokoch:
  1. upgrade na React 19 s kontrolou všetkých obrazoviek,
  2. scéna a panely,
  3. what-if a akcie WMS.
- React 19, R3F 9, drei 10, zustand 5 (ADR-046). Spoločné 3D diely v čistom three.js pre `/shadow` aj mapu, bez `react-three-map`.
- Horizont scenára je do konca prevádzkového dňa (15:00), lebo kaskády vznikajú v noci.
- Presun jazdy na obsadenú bránu: akcia WMS vráti 409, scenár ukáže čakanie.
- Scenáre spúšťa dispečer a admin, ochranka scénu len prezerá. GLTF len ako mechanizmus, predvolene jednoduché tvary.
- **Kaskáda v Pythone aj v TypeScripte:** spoločné testovacie prípady v JSON v repozitári overí pytest aj vitest, aby sa vzorce nerozišli (ADR-047).
- `frameloop="demand"`: kým sa balíky hýbu po páse, `ParcelFlow` volá `invalidate()` každý frame, aby animácia nezamrzla.
- Údržba nesmie odstrániť zaručený scenár degradácie skenera z predvoleného seedu, Fáza 6 ho potrebuje.
- Kontrola fps má konkrétny nástroj aj cieľ (napr. 60 fps pri 1440 px počas večernej vlny). Výsledok sa zapíše do `docs/fazy`.

**Simulácia scenárov (what-if) – panel „Scenár“:**
- Typy zásahov:
  - meškanie jazdy o X min,
  - výpadok zariadenia,
  - zmena čítanosti skenera,
  - pridanie skenera na bránu,
  - presun jazdy na inú bránu.
- Telematika spustí **kópiu simulácie** od aktuálneho času do konca vlny:
  - zrýchlene,
  - bez zápisu do živých dát,
  - deterministicky.
- Výsledok je porovnanie KPI **plán vs. scenár**:
  - meškanie prechodov,
  - kaskádové varovania,
  - neidentifikované balíky,
  - zlé smery.
- Dotknuté objekty sa zvýraznia v scéne.

**Akcie WMS zo scény** (cez bežné API s RBAC):
- presun jazdy na inú bránu,
- označenie zariadenia na údržbu,
- potvrdenie alarmu.

**Architektúra 3D:**
- Ostávame na **React + Vite + R3F**, nie Next.js. Zapísať ADR s dôvodmi:
  - app je za loginom,
  - SSR nefunguje pre 3D scénu,
  - frontend musí servírovať app (4 kontajnery).
- Bundle:
  - `/shadow` a 3D vrstva mapy cez `React.lazy` a dynamický import,
  - three.js a R3F nesmú byť v hlavnom bundli,
  - overiť analýzou bundlu (`rollup-plugin-visualizer`), výsledok dať do docs.
- Používať hotové komponenty z **drei** (`Instances`, `Html`, `Bounds`, `useGLTF`, `Detailed`, `ContactShadows`, `OrbitControls`), nevymýšľať vlastné.
- Malé komponenty v `src/shadow/` (`Hall`, `Conveyor`, `Dock`, `Truck`, `DevicePin`, `ParcelFlow`, `CameraRig`). Rozloženie len z `/api/layout`.
- Dáta a výkon:
  - vysokofrekvenčné WebSocket dáta do **zustand** store, v scéne ich čítať cez refy v `useFrame` (bez re-renderu pri každom skene),
  - React state len pre panely a výber,
  - `frameloop="demand"` alebo nižšie fps, keď sa nič nehýbe alebo karta nie je viditeľná.
- **Jedna zdieľaná knižnica 3D komponentov** pre `/shadow` aj 3D halu na mape (dnes `components/map/depot3d.ts` v čistom three.js).

## Fáza 5c – Digitálny tieň v2: layout podľa referencie a reálne brány (pred Fázou 5b) *(hotové)*

**Schválené s plánom 5c (kroky 5c-1 layout, 5c-2 scéna v2, 5c-3 reálne brány, 5c-4 GLTF a hub, každý vlastný commit):**
- *5c-1 hotové:* plávajúce panely nad scénou, lišta tieňa, KPI „balíky v aktuálnej vlne“, ovládanie kamery, zoznam Brány/Kamióny/Zariadenia, sledovanie balíka, scenár v draweri, odkazy na `/parcels/:id`, `/fleet?plate=`, `/loading?door=`.
- *5c-2 hotové:* kamera zo strany dvora (~38°), plné steny a strecha s odkrytím (tlačidlo, automaticky pri výbere zariadenia alebo nájdenom balíku), čísla brán na fasáde, sekcionálne brány (otvorené s balíkmi pri kamióne), státia a jazdný pruh na dvore, piny v tvare kvapky s popiskom len pri hoveri alebo výbere, kamióny vo farbách témy. Stále 60 fps (záťažový režim, 1440 px).
- *5c-3 hotové (ADR-050):* `doors.door_drive` a `doors.dock_equipment` s dočasným seedom, dverové senzory `DOOR-SNS-01…08` (open / closed / fault), stav brány v scéne aj v paneli len zo senzora, pri poruche neutrálna brána so štítkom „senzor – porucha“, mostík a teleskopický pás v 3D. Senzor mimo čítanosti, metrík aj ML dát (test).
- *5c-4 hotové (ADR-051, ADR-052):* hub `BAH` presunutý do Ivanky pri Dunaji podľa budovy z OSM (migrácia aj seed, overené z čistého klonu), modely Kenney CC0 (dodávky a autá z Car Kitu 3.1, krabice z Factory Kitu 3.0 ako inštancie geometrie), kamión ostal vlastný diel, kuriérske dodávky pri odstavných plochách. Stále 60 fps v záťažovom režime. Vysvetlenie fázy: [docs/fazy/faza-5c-tien-v2.md](fazy/faza-5c-tien-v2.md).
- Brána má dve polia: `door_drive` (`electric` | `manual`) a `dock_equipment` (`dock_leveler` | `telescopic_conveyor` | `none`). Dočasný seed, kým tím nedodá reálne rozloženie Budimíra:
  - LD-01–02: `electric` + `dock_leveler` (2 hlavné s rampou),
  - LD-03–05: `electric` + `telescopic_conveyor` (plošina),
  - LD-06–08: `electric` + `none`,
  - kuriérske SB: `manual` + `none`.
- `door_sensor` nesmie vstupovať do čítanosti v KPI, do `device_metrics_minutely` ani do dát pre prediktívnu údržbu (Fáza 6). Pokryje to test.
- `*.glb binary` do `.gitattributes` pred prvým modelom, modely spolu do ~2 MB.
- KPI „balíky dňa“ sa mení na **„balíky v aktuálnej vlne“** podľa zadania (5c-1):
  - večerná vlna (15:30–22:00, `services/waves.py`) sú balíky dňa okrem nočných,
  - nočná vlna (01:00–06:00) sú balíky z nočných kamiónov,
  - mimo vĺn KPI ukáže „mimo vlny“ a čas ďalšej vlny.
- Hub sa presunie do Ivanky pri Dunaji, len ak to pokryje offline cestná sieť.
Spätná väzba tímu na Fázu 5: scéna funguje, ale **layoutom sa nepodobá na referenciu** ([docs/design/reference.png](design/reference.png)).
Dnes je `/shadow` stránka s kartami pod sebou a malou scénou v karte, takže sa scrolluje. Cieľom je, aby **layoutovo** zodpovedala referencii.
Nemusí ísť o presnú kópiu. Podrobnejšie veci sa otvárajú v overlayi alebo na samostatnej obrazovke.

**Layout (desktop 1280 / 1440 px, bez scrollu stránky):**
- 3D scéna cez celú plochu pod hornou lištou aplikácie. Všetko ostatné sú **plávajúce panely nad scénou** (biele, zaoblené, tieň, ako v `docs/design/README.md`).
- **Lišta tieňa hore:**
  - prepínač skladu (Budimír / Bratislava) s kontextom, napr. „6/8 brán obsadených“, aby sa nemuselo chodiť cez Flotilu,
  - vyhľadávanie (balík, ŠPZ, brána),
  - živý simulovaný čas,
  - tlačidlo „Scenár“.
- **Vľavo hore:** 3–4 KPI karty.
- **Vpravo:**
  - zvislý stĺpec ovládania kamery: +, −, otočiť vľavo/vpravo, domov,
  - **detailový panel** vybraného objektu (brána, kamión, zariadenie, balík), ktorý sa zatvára krížikom.
- **Vľavo dole:** sledovanie balíka ako horizontálna časová os (kruhové kroky). Zobrazí sa po vyhľadaní alebo kliknutí na balík.
- **Vpravo dole:**
  - taby **Brány x/y · Kamióny · Zariadenia**,
  - riadok = kód, stav, mini progress, „›“,
  - klik zaostrí kameru na objekt a otvorí detail.
- **Scenár (čo ak)** nie je natrvalo na stránke. Otvára sa ako bočný drawer alebo overlay cez scénu.
- **Hlbší detail** (celá história balíka, nakládka, vozidlo na mape) je odkaz na existujúce obrazovky: `/parcels/:id`, `/loading?door=`, `/fleet?plate=`.
- **Mobil 390 px:** scéna hore, panely ako bottom sheet.

**Scéna:**
- Kamera bližšie a viac zboku (izometria ~35–45°). Fasáda s bránami zaberá väčšinu pohľadu, ako v referencii, nie celý areál zhora.
- **Hala:**
  - plné steny a strecha,
  - čísla brán nad bránami na fasáde, otvorené brány s balíkmi v otvore,
  - pás vnútri vidno cez „odkrytie strechy“ (prepínač alebo automaticky pri výbere zariadenia vnútri).
- **Dvor:**
  - asfalt s vyznačenými státiami a prerušovanými jazdnými pruhmi,
  - vjazdová brána so závorou,
  - kamióny na dvore podľa prejazdov.
- **Piny** v tvare kvapky nad objektmi, popisky len pri hoveri alebo výbere. Dnes sa popisky brán prekrývajú („LD-08 · SE“, „06 · HE“…).
- Farby z témy (Oranžová / Modrá), nie natvrdo modrá z referencie.
- Kvalita nad primitívami: GLTF z existujúceho mechanizmu je teraz vítaný, napr. CC0 balíky od Kenney (vozidlá, krabice, pás). Licenciu over a zapíš ju.
- Výkon ostáva: 60 fps pri 1440 px počas večernej vlny.

**Reálne typy brán v depe (podľa skúsenosti z depa SPS):**
- **2 hlavné kamiónové brány:** elektrická sekcionálna brána na tlačidlo a **vyrovnávací mostík (rampa)**, ktorý sa zdvihne ku kamiónu.
- **3 brány na plošine:** **vysúvací (teleskopický) pás** do kamióna, ovládaný tlačidlami.
- **Kuriérske brány:** často **mechanické, na lanko** (ručné).
- V dátach to bude vybavenie brány, napr. `doors.equipment`: `dock_leveler`, `telescopic_conveyor`, `manual`, a podľa neho iný 3D model. Ktorá brána má aké vybavenie, je v seede alebo rozložení a dá sa upraviť bez zmeny kódu.
- **Stav brány** (otvorená / zatvorená / porucha) vidíme z lacného **dverového kontaktného senzora** (retrofit, sedí k príbehu Depot 5.0), v simulátore ako udalosti. Tieň stav **len zobrazuje**, bránu neovláda. Inak by to bolo dvojča (ADR-045).

**Rozloženie skladov:**
- **Budimír:** skutočné rozloženie (poradie brán, ich typy, plochy, pás) dodá tím (Lukspie). Dovtedy ostáva súčasné, ale všetko je dátami v `/api/layout`, nič natvrdo.
- **Bratislava:** hub SPS v **Ivanke pri Dunaji**. Tvar a rozmery haly skús zistiť z budov v OSM extrakte (`tools/osm`). Ak tam nie sú, ostane schematická hala.

## Zmena plánu pred odovzdaním (6. 11. 2026, termín nedeľa 8. 11.)
Poradie práce:
1. **5d skrátená** *(hotové: hotfix, krok 1, krok 2, alarmy, prah 15 min)*:
   - hotfix 400 *(hotové)*,
   - krok 1 ovládanie času,
   - krok 2 situácie vrátane `calm-night`,
   - z kroku 5 len uzavretie starých alarmov a KPI alarmov len pre aktuálny deň,
   - z kroku 4 len prah oneskoreného prechodu 15 min.
2. **Azure** *(hotové a overené 7. 11. 2026, ADR-056)*:
   - db-telemetry pôjde do Azure Database for PostgreSQL Flexible Server (B1MS, PG 16). Server vytvorí používateľ, návod bude v README (portal aj az CLI, firewall, `sslmode=require`),
   - telematika sa pripája cez `TELEMETRY_DATABASE_URL` so SSL a migračný runner (ADR-012) prejde aj proti Azure,
   - kontajner db-telemetry ostane ako záloha v compose profile `local` (offline demo, testy). Predvolený režim je Azure (ADR-056),
   - overiť: skeny pribúdajú, `/system` ukazuje Azure DB ako healthy, latencia nebrzdí simuláciu (dávky zápisov), testy bežia proti lokálnej DB.
3. **Fáza 6 – ML** (PROMPT §8) *(hotové všetky 4 časti, ADR-057 až 060, ml/README.md)*. Poradie je priorita a každá časť má časový limit. Ak sa nestihne, vznikne jednoduchšia verzia a zapíše sa.
   1. **Predikcia meškania kamiónov:**
      - HistGradientBoostingRegressor na histórii z `gen:history`, príznaky podľa §8,
      - metrika MAE v minútach voči baseline (priemer na smer),
      - inferencia v app plní `predicted_arrival` pre tabuľu ETA a kaskádu.
   2. **Prediktívna údržba skenerov:**
      - IsolationForest nad `device_metrics_minutely` (bez `door_sensor`),
      - úloha každých 5 sim. minút, nad prahom alarm „klesajúca čítanosť, skontrolovať optiku“,
      - musí zachytiť zaručenú degradáciu zo seedu (test),
      - skóre rizika v paneli zariadenia v tieni.
   3. **Brána (CV):**
      - predtrénovaný YOLO (car/truck/bus) v ONNX a OCR ŠPZ nad onnxruntime (napr. RapidOCR), slovenská ŠPZ overená regexom, ak sa dá, bez torch v image app,
      - `POST /api/gate/detect` (obrázok → typ, ŠPZ, istota → prejazd cez telematiku), `/gate` pre ochranku s uploadom, `ml/gate_video.py` na hostovi,
      - licencie modelov (YOLO od Ultralytics je AGPL).
   4. **IoT skener na nakládke (prototyp):**
      - `ml/dock_scanner.py` na hostovi (webkamera alebo video): QR a čiarové kódy, počítanie krabíc prechodom cez čiaru, posiela skeny rovnakým API ako simulátor,
      - skript na tlač štítkov balíkov dňa (PDF s QR).
   - **Spoločné:**
     - artefakty v `ml/artifacts` (`*.onnx`, `*.joblib` binary). Bez artefaktu app naštartuje a UI ukáže „model nedostupný“,
     - tréning jedným príkazom, `ml/README.md` pre každý model (dáta, príznaky, metriky, obmedzenia),
     - testy (načítanie modelov, inferencia cez HTTP, detekcia degradácie) a reviewer na konci.
4. **Z 5b len** *(hotové)* oprava poradia zastávok na `/courier` (85/92 hotových, ale „ďalšia“ je č. 2, ETA nesedia).
5. **Nedeľa, minimálna Fáza 7:**
   - `docs/architektura.md` (mermaid: služby, Azure, toky dát, bezpečnosť), `docs/api.md` (endpointy oboch backendov z OpenAPI), `docs/demo.md` (scenár obhajoby so situáciami),
   - README a `docs/fazy/faza-6-ml.md`,
   - kontrola z čistého klonu (bez mazania volumes) a screenshoty hlavných obrazoviek v situácii `evening-peak`.

## Fáza 7b – demo (7. 11. 2026, pred odovzdaním)
Poradie je priorita. Po každom bode commit, reviewer po bodoch 1 a 2 a na konci. Čo sa nestihne kvalitne, ide do „Po odovzdaní“.
1. **Brána – rozhodovanie** (ML odporúča, pravidlá rozhodujú, pri neistote rozhodne človek) *(hotové, ADR-061)*:
   - identitu vozidla neurčuje obraz. Model určí typ (osobné, dodávka, kamión), OCR prečíta ŠPZ a identitu rozhodne porovnanie s vozovým parkom (`vehicles`) a so zoznamom povolených externých ŠPZ,
   - kuriérska dodávka so známou ŠPZ → prejazd automaticky,
   - kamión so známou ŠPZ → prejazd. S neznámou alebo neprečítanou ŠPZ → prejazd povolený, ale vznikne príznak „overiť“, ktorý ochranka potvrdí a tým zruší,
   - osobné vozidlo, ktorého ŠPZ nie je v DB → zamietnuté, čaká na rozhodnutie ochranky (povoliť / zamietnuť, s poznámkou),
   - nízka istota modelu alebo OCR (prahy v konfigurácii) → vždy rozhodne ochranka,
   - na `/gate` front rozhodnutí pre ochranku, každé rozhodnutie ide do auditu (kto, kedy, prečo),
   - simulátor generuje mix prejazdov (dodávky, kamióny, občas neznáme auto),
   - testy cez HTTP pre každú vetvu, ADR, vyhodnotenie na našich fotkách v `ml/README.md` (správne / spolu pre typ a ŠPZ) a obmedzenia bez prikrášľovania.
2. **Kuriér – mobilná aplikácia** *(hotové, ADR-062)*:
   - `/courier` na desktope v ráme telefónu (~390 × 844) v strede, na telefóne na celú obrazovku, spodná navigácia (Zastávky / Mapa / Skener), veľké tlačidlá, mapa s ďalšou zastávkou a trasou,
   - simulovaný Bluetooth skener spárovaný s vozidlom („Skener pripojený · KE-301KR“). Sken balíka v dodávke vyberie ďalšiu zastávku a ukáže ju na mape,
   - typ doručenia: osobné odovzdanie (časové okno), do schránky, do výdajného boxu (seed ~60 / 25 / 15 %). Poradie rešpektuje okná osobných odovzdaní, boxy a schránky vypĺňajú medzery (heuristika lepšia ako nearest neighbor), ETA a „stihneš / nestihneš okno“, ADR,
   - oprava: pred nakládkou UI ukáže stav nakládky, nie neaktívne „Doručené“,
   - appka sa otvorí na telefóne v rovnakej Wi-Fi (`http://<IP PC>:8000/courier`): origin, cookies a CSRF pre LAN, postup v `docs/demo.md`.
3. **Dispečeri** *(hotové)*: 3 dispečerské účty v seede (mená, smena ranná / poobedná / nočná), viditeľné v admine, heslá z `.env`.
4. **Ranná nakládka:** kuriéri od 6:30 nakladajú dodávky pri odstavných plochách, dodávky stoja v areáli depa v tieni aj na mape Flotily a potom vyrážajú. Kamióny ako doteraz.
5. **Layouty skladov** (ak ostane čas): Budimír, Ivanka pri Dunaji a nový sklad Žilina (len layout a vozidlá). Geometria z OSM (`tools/osm`, ADR-051), satelitné snímky tímu len na kontrolu počtu a strany rámp. Rampy, státia a parkovanie dodávok v tieni aj vo Flotile. Keď budova v OSM nie je jednoznačná, nehádať a vypísať kandidátov.

## Po odovzdaní
- 5d krok 3 (incidenty v živej simulácii), krok 4 okrem prahu 15 min (výber zo zoznamov s predikciou, rezerva do závislých odchodov, nové KPI, horizont ďalšieho dňa, golden testy), krok 6 (e2e Playwright).
- 5d krok 5 okrem uzavretia starých alarmov (deduplikácia, automatické uzatváranie vyriešených).
- 7b bod 2: kratšie trasy kuriérov pri oknách (okná ponúkať podľa plánovanej trasy, alebo 2-opt na pozadí). Dnes +82 % km a väčšina návratov po 15:00 (ADR-062).
- Fáza 5b okrem `/courier`: UX review všetkých obrazoviek, `/shadow` podľa makety, `/board` pri 390 px, nové screenshoty Fázy 4.

## Fáza 5d – Simulácia a testovanie (pred Fázou 5b)
Problém: scenár „čo ak“ v praxi veľmi nefunguje. Testovať konkrétne situácie je pracné (čakanie na 15:00, skoky bez dát) a v areáli sa nahromadilo 260+ aktívnych alarmov (4. 11. 2026: 202 `wrong_direction` a 81 `cascade_delay` od 25. 10.).

0. **Diagnóza ako prvý krok, bez opráv:** zistiť, prečo scenár nefunguje.
   - Overiť ho v rôznych časoch (10:00, 15:45, 18:30, 02:00, 05:45) a so všetkými typmi zásahov.
   - Výsledky dať do tabuľky (čas, zásah, očakávané, skutočné, príčina) a zastaviť sa.
1. **Ovládanie času** (admin, API telematiky):
   - skok na ľubovoľný čas HH:MM, nielen predvoľby,
   - dva režimy skoku:
     - „preskočiť“ (dnešné správanie, ADR-025),
     - „pretočiť s dátami“ (rýchlo dosimuluje preskočený úsek, aby skeny, prejazdy a alarmy nadväzovali),
   - pauza a krok +5 / +15 / +60 min,
   - „čistý reset dňa“: zmaže alarmy, okná údržby, presuny jázd a zásahy, vráti seed a začne deň znova.
2. **Situácie**, teda pomenované deterministické predvoľby (seed + čas + vložené udalosti), načítané jedným klikom do pár sekúnd:
   - Večerná vlna – špička (18:30), Nočné kamióny s kaskádou (02:10), Ranné odchody (05:45), Kuriéri ráno (07:20), Degradácia skenera LD-05, Mimo vlny (10:00).
   - **Pokojná noc (`calm-night`)**: v pláne nie je žiadna kaskáda (bez zaručenej poruchy), aby scenár ukázal, ako kaskáda vznikne (napr. meškanie nočného BA).
   - Dostupné v admine, cez API a cez URL (`?situation=evening-peak`), aby ich používal aj skript na screenshoty, e2e testy a demo na obhajobe.
   - Rovnaká situácia musí dať vždy rovnaké čísla (test).
3. **Vkladanie incidentov do živej simulácie** (nie do what-if), na demo a testy:
   - meškanie jazdy o X min,
   - skener degradovaný alebo offline,
   - balík v zlom smere,
   - neznáma ŠPZ na bráne,
   - porucha dverového senzora,
   - nezastihnutí zákazníci.

   Každý zásah sa zaloguje, je viditeľný v admine a čistý reset ho vráti.
4. **Oprava scenára „čo ak“:**
   - funguje v každom čase; keď v horizonte nie sú budúce jazdy, UI to jasne povie a ponúkne horizont ďalšieho dňa,
   - jazdu a zariadenie vyberáš zo zoznamu, nie písaním,
   - výsledok je tabuľka plán vs. scenár s rozdielom a zvýraznením v scéne,
   - golden testy: každý typ zásahu v 2–3 situáciách s očakávaným smerom zmeny KPI,
   - *hotfix pred krokom 1:* validácia `read_rate` a `move_trip` (400) opravená, HTTP test pre každý typ zásahu,
   - **oneskorený prechod** je odchod viac ako 15 min po pláne. Prah je v konfigurácii, aby náhodné prevádzkové meškanie nenasýtilo KPI,
   - panel ukazuje **rezervu do závislých odchodov** („rezerva 3 h 05 min“),
   - **nové KPI:** meškanie diaľkových odchodov a balíky, ktoré nestihnú svoj odchod,
   - **výber jazdy** ukazuje predikovaný čas (nočný BA ~06:05). Prebehnuté jazdy sa v zozname nezobrazujú.
5. **Hygiena alarmov:**
   - deduplikácia a automatické uzatváranie vyriešených alarmov,
   - situácie štartujú bez starých alarmov,
   - KPI nesmie ukazovať stovky alarmov z minulých dní.
6. **E2E testy:** Playwright na hostovi ako dev závislosť frontendu, nie nový kontajner (ostávajú 4).
   - Pre každú situáciu načítať hlavné obrazovky ako správna rola.
   - Overiť, že v konzole nie sú chyby a že stránka nepreteká pri 1280 / 1440 / 390 px, a urobiť screenshoty.
   - Jeden príkaz typu `npm run e2e`, postup v README.

**Schválené s plánom 5d (defaulty otvorených otázok OK) a doplnenia tímu:**
- *Krok 0 hotový:* diagnóza je v [docs/fazy/faza-5d-diagnoza.md](fazy/faza-5d-diagnoza.md).
- **Replay:**
  - najprv zmerať, kde je úzke hrdlo,
  - prednosť má dávkový interný endpoint v app (hromadný insert) pred štartovacou snímkou,
  - snímka len ako automatická cache s kľúčom (seed, situácia, verzia kódu), nie ručne udržiavaný súbor.
- **Krok +N min a replay o N min sú rovnaký kód.** Test: step 60 == replay 60 (rovnaké skeny).
- **E2E `/track`:** token sa po načítaní situácie vytiahne z admin API notifikácií. Tokeny sa nerobia deterministické (ADR-042).
- **README:** veta, že v ostrom režime sa nastavuje `SIM_CONTROLS_ENABLED=false` (krok 1).
- **Staré alarmy** sa uzavrú (audit ostane), nezmažú sa. Čistý reset maže len alarmy aktuálneho dňa.
- **`SIM_CONTROLS_ENABLED=false`** vypne ovládanie času, situácie aj incidenty. Scenár „čo ak“ nie.
- **Horizont ďalšieho dňa vo what-if:** plán a manifesty D+1 vygeneruje app rovnakým seedom cez interné API, len na čítanie. Konečné rozhodnutie v kroku 4 podľa diagnózy.

**Pravidlá:**
- Ovládanie simulácie je len pre admina. V ostrom režime sa vypína premennou `SIM_CONTROLS_ENABLED`.
- Determinizmus simulátora ostáva.
- ADR pre situácie, režimy skoku a e2e.
- Commit po krokoch, reviewer po krokoch 1–4.

## Fáza 5b – UX review (po Fáze 5)
- **Vizuálny cieľ pre `/shadow` je schválená maketa [docs/design/maketa-tien/](design/maketa-tien/README.md)** (README + PNG). V 5b sa digitálny tieň upraví podľa nej. Reviewer porovnáva screenshot s `tien-maketa.png`, nie s `reference.png`. Showcase čas je situácia „Večerná vlna – špička“ z Fázy 5d.
- Prejsť všetky obrazovky za každú rolu a urobiť screenshoty pri 3 šírkach. Spísať zoznam problémov a opraviť ich.
- Osobitne skontrolovať:
  - `/board`: čitateľný na veľkom displeji z diaľky,
  - `/loading`: veľké prvky a výrazný alarm,
  - `/courier` a `/track`: plne použiteľné na mobile.
- Nájdené pri upgrade na React 19 (nesúvisí s ním): `/board` pri 390 px vodorovne preteká o ~150 px (tabuľa jázd).
- Nafotiť znova screenshoty Fázy 4 (ešte ukazujú „DepoTrack“ a „Digitálne dvojča“).

## Fáza 7 – doplnky
- **Offline PMTiles výrez SR** ako záloha mapového podkladu pre obhajobu bez internetu: súbor servíruje app, ostávajú 4 kontajnery (ADR-040).
- **Deprecation warning v testoch app** (Starlette `TestClient` nad `httpx`): odsúhlasené vyriešiť až vo Fáze 7.

## Otvorené otázky (zatiaľ nerozhodnuté)
- **Simulácia kuriérov na mape:** dodávky už jazdia po uliciach vo `/fleet` (Fáza 4). Upresniť s tímom, čo konkrétne chýba (napr. viditeľnejší pohyb, zastávky, prehrávanie dňa).
- ~~Limit pre platný token na `/api/track`~~ → rozhodnuté pred Fázou 5: **60/min na token** (ADR-042), hodnota je v `.env`.
- ~~„SPS“ mimo UI textov~~ → rozhodnuté pred Fázou 5 (ADR-044): prefix `DP` pre nové dni, SMS „Depot 5.0:“, kontext SPS ostáva v `docs/PROMPT.md` a v starších ADR ako história. Tím to môže zmeniť.
- **3D stack pre Fázu 5:**
  - R3F 9 a drei 10 vyžadujú React 19, projekt je na React 18. Možnosti:
    - upgrade na React 19,
    - R3F 8 a drei 9 (kompatibilita s three 0.186 neoverená).
  - Zdieľaná knižnica pre mapu potrebuje most R3F ↔ MapLibre custom layer. Možnosti:
    - `react-three-map`, ktorý vyžaduje `react-map-gl` (dnešný `MapView` používa čistý maplibre-gl),
    - vlastný most cez R3F `createRoot` (zadanie však žiada nevymýšľať vlastné).
- **Jednorazová chyba v testoch app:**
  - pri behu podmnožiny testov raz padol `test_depots` s `cache lookup failed for type`,
  - celý beh aj beh z čistého klonu prešli,
  - sledovať, či sa zopakuje.

## Pravidlá práce
- `docker compose down -v` ani mazanie volumes sa nespúšťa bez výslovného súhlasu.
