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

## Fáza 5 – Digitálny tieň (`/shadow`)
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

## Fáza 5b – UX review (po Fáze 5)
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
