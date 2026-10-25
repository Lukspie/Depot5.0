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
- Témy: **SPS** (oranžová, čierna, sivá – predvolená) a **Modrá** podľa referencie (ADR-032).
- Vizuálny cieľ je [docs/design/reference.png](design/reference.png) (popis v [docs/design/README.md](design/README.md)). Jeho štýl platí pre KPI karty, panely a celkovú paletu na všetkých obrazovkách, nielen v dvojčati.

## Fáza 3b – mapa a sklady *(hotové, ADR-038 až 040)*
- MapLibre GL + OpenFreeMap (svetlý vektorový štýl, náklon ~45°, 3D budovy, vlastné piny, trasa vybraného vozidla, prelet kamery). Rovnaký komponent neskôr pre `/track` a `/courier`.
- Depo v **Budimíri**, hub v **Bratislave** (tabuľka `depots`, `depot_id` v dátovom modeli).
- 3D hala na mape (Three.js custom layer) z rovnakého rozloženia ako `/twin`, klik na sklad otvorí `/twin?depot=…`.
- Offline cestná sieť a reálne adresy z OSM, routing A* v telematike bez internetu za behu.

## Fáza 5b – UX review (po Fáze 5)
- Prejsť všetky obrazovky za každú rolu a urobiť screenshoty pri 3 šírkach. Spísať zoznam problémov a opraviť ich.
- Osobitne skontrolovať:
  - `/board`: čitateľný na veľkom displeji z diaľky,
  - `/loading`: veľké prvky a výrazný alarm,
  - `/courier` a `/track`: plne použiteľné na mobile.

## Fáza 7 – doplnky
- **Offline PMTiles výrez SR** ako záloha mapového podkladu pre obhajobu bez internetu: súbor servíruje app, ostávajú 4 kontajnery (ADR-040).

## Pravidlá práce
- `docker compose down -v` ani mazanie volumes sa nespúšťa bez výslovného súhlasu.
