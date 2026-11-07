# ML modely Depot 5.0 (Fáza 6)

> Pre koho: kto píše kapitolu dokumentácie o ML, alebo model pretrénuje. Ku každému modelu: dáta, príznaky, metriky, obmedzenia. Rozhodnutia sú v ADR-057 a ďalších.

Artefakty sú v `ml/artifacts/` a app ich načíta pri štarte (sú skopírované do image). Ak artefakt chýba alebo bol uložený inou verziou scikit-learn, app naštartuje bez modelu a `/system` ukáže „model nedostupný“.

## Príprava dát

História sa generuje rovnakými modelmi meškania a čítanosti ako živý simulátor (deterministicky, seed 42):

```bash
cd telematics
npm run gen:history -- --days 180 --out ../ml/data
```

Výstup (v `.gitignore`, ~13 MB):
- `ml/data/trips_history.csv`: 2 880 udalostí jázd (180 dní × 16),
- `ml/data/device_metrics_history.csv`: 270 000 minútových metrík skenerov s označenými epizódami degradácie (objem ako v živom simulátore: ~1 položka/min na bránu).

## 1. Predikcia meškania kamiónov

**Tréning jedným príkazom** (beží v image app, aby sedela verzia scikit-learn aj kódovanie príznakov s inferenciou):

```bash
# Git Bash na Windows: MSYS_NO_PATHCONV=1 a $(pwd -W) namiesto $PWD
docker compose run --rm --no-deps -u root -v "$PWD/ml:/app/ml" app python ml/train_delay.py
```

Vznikne `ml/artifacts/delay_model.joblib` a `delay_model.json` (metriky). Po pretrénovaní treba `docker compose build app`.

- **Úloha:** o koľko minút neskôr nastane plánovaná udalosť jazdy, teda príchod pri príjazde alebo odchod pri odjazde. Pre príjazdy z toho vzniká `predicted_arrival` pre tabuľu ETA, dispečing a kaskádové varovania.
- **Model:** `HistGradientBoostingRegressor` so stratou `absolute_error` (metrikou je MAE), 300 iterácií, `learning_rate` 0,05, 15 listov. Smer, druh jazdy a počasie sú kategorické.
- **Príznaky** (kódovanie v `app/src/depotrack/ml/delay.py`, zdieľané s tréningom):

  | Príznak | Význam |
  | --- | --- |
  | `direction` | smer (BA, BB, ZA, MI, TV, HE, SL, SE) |
  | `kind` | príjazd / odjazd |
  | `weekday`, `month`, `hour` | deň v týždni, mesiac (sezóna), hodina plánovanej udalosti, miestny čas |
  | `weather` | simulované počasie dňa (jasno, dážď, hmla, sneh) z telematiky |
  | `prev_delay_min` | meškanie tej istej jazdy predchádzajúci deň |

  Vzdialenosť trasy je pre smer konštantná, preto ju pokrýva smer.
- **Rozdelenie:** podľa času, posledných 30 dní je test (480 udalostí), 150 dní tréning (2 400). Po vyhodnotení sa model pretrénuje na všetkých dňoch.
- **Výsledok (dáta 11. 5. – 6. 11. 2026):**

  | | MAE modelu | MAE baseline (priemer na smer a druh) |
  | --- | --- | --- |
  | všetky udalosti | **6,14 min** | 7,19 min (−15 %) |
  | príjazdy | **8,72 min** | 10,87 min (−20 %) |
  | odjazdy | 3,55 min | 3,51 min |

  Pri odjazdoch model nepomôže: ich meškanie je hlavne náhodné prevádzkové meškanie bez väzby na príznaky. Prínos je pri príjazdoch, kde počasie a meškanie predchádzajúceho dňa vysvetľujú časť rozptylu.
- **Použitie v app** (`services/ml_eta.py`, úloha `ml_job` každých 5 simulovaných minút):
  - plánovaným príjazdom dňa doplní `predicted_arrival = plán + predikcia` a `predicted_by = "ml"`, potom prepočíta kaskádu,
  - keď telematika pošle vlastný odhad z polohy alebo poruchy (`predicted_by = "telematics"`), ten má prednosť a model jazdu už neprepisuje,
  - `GET /api/ml/delay/trips/{id}` (dispečer) ukáže príznaky a predikciu jednej jazdy, `GET /api/ml/status` stav modelov.
- **Obmedzenia:**
  - učí sa na simulovanej histórii, takže sa naučí model simulátora, nie skutočné SPS dáta (tie nemáme),
  - zaručená porucha nočného kamióna (ADR-024) nie je v histórii, to je udalosť, ktorú vidí až telematika počas jazdy,
  - počasie je jedno pre celý deň a celé Slovensko.

## 2. Prediktívna údržba skenerov

**Tréning:**

```bash
docker compose run --rm --no-deps -u root -v "$PWD/ml:/app/ml" app python ml/train_scanner.py
```

Vznikne `ml/artifacts/scanner_model.joblib` a `scanner_model.json`.

- **Úloha:** včas spoznať skener brány, ktorému sa špiní optika (čítanosť pomaly klesá), a otvoriť alarm „Skener brány LD-xx – klesajúca čítanosť, skontrolovať optiku“.
- **Dáta:** minútové metriky ôsmich skenerov brán (`device_metrics_minutely` v histórii, bez dverových senzorov, ADR-050), sčítané do **10-minútových bucket-ov**, rovnakých, aké telematika posiela app (`GET /devices/{kód}/metrics`). Generátor má 38 epizód degradácie (optika sa špiní 6–48 h, oprava o 1–3 dni neskôr), v teste ich je 10.
- **Model:** `IsolationForest` (300 stromov) natrénovaný **len na zdravých bucket-och** tréningových dní. Označenia epizód sa používajú až pri vyhodnotení.
- **Príznaky** (`app/src/depotrack/ml/scanner.py`, zdieľané s tréningom):

  | Príznak | Význam |
  | --- | --- |
  | `z_30m` | o koľko štandardných chýb je čítanosť za posledných 30 min (3 bucket-y s prevádzkou) pod referenčnými 95 % |
  | `z_2h` | to isté za posledné 2 h (trend) |

  Štandardná chyba je binomická, podľa počtu položiek, takže nízka čítanosť z pár balíkov váži menej ako rovnaká z plnej vlny.
- **Prečo takto (iterácie):**
  - prvá verzia mala čítanosť a počet položiek: zdravé okná s pár položkami majú náhodne nízku čítanosť a vytlačili prah tak vysoko, že degradáciu zo seedu nechytila,
  - druhá pridala z-skóre k čítanostiam, ale IsolationForest pri extrémoch saturuje a pri živom objeme (~1 položka/min) alarm prišiel až po konci vlny,
  - finálna verzia má len dve z-skóre, nižší prah a perzistenciu.
- **Skóre a prah:**
  - skóre anomálie je `−score_samples`,
  - prah je 98. percentil skóre zdravých bucket-ov s čítanosťou pod mediánom (0,953),
  - **alarm až pri 2 po sebe idúcich 10-min bucket-och nad prahom** (perzistencia): šum sa neopakuje, špinavá optika áno,
  - skener, ktorý číta lepšie ako bežne, je síce „nezvyčajný“, ale nie rizikový, preto má skóre najviac medián,
  - riziko v tieni = (skóre − medián) / (prah − medián), orezané na 0–100 %, pri 100 % sa otvorí alarm,
  - alarm sa zavrie pod 50 % (hysterézia, aby neblikal).
- **Výsledok (posledných 45 dní):**

  | Metrika | Hodnota |
  | --- | --- |
  | zachytené epizódy degradácie | **10 z 10** |
  | presnosť bucket-ov s alarmom (precision) | 0,88 |
  | recall bucket-ov s viditeľným poklesom (≥ 4 body pod normálom) | 0,60 |
  | falošné alarmy na zdravých bucket-och | 0,54 % |
  | medián oneskorenia od začiatku epizódy | 24 h (epizódy trvajú 6–48 h a prechádzajú viac vĺn) |

- **Zaručená degradácia zo seedu** (`SIM_DEGRADED_DEVICE`, 0,97 → 0,85 za 6 h od 15:30, ADR-024): vo večernej vlne svojej brány (17:05–21:15) pri živom objeme spustí alarm okolo 20:45 pri čítanosti ~0,87. Zdravé skenery (0,93–0,97 so šumom) alarm nespustia. Overuje to `app/tests/test_ml.py`.
- **Použitie v app** (`services/ml_scanner.py`, úloha `ml_job` každých 5 simulovaných minút):
  - pre každý skener brány si vezme bucket-y za 2 h z telematiky (db-telemetry môže byť v Azure),
  - skóre uloží pre `GET /api/ml/scanners` (panel zariadenia v tieni: „Riziko poruchy (ML)“),
  - otvára a zatvára alarm `scanner_degradation` zariadenia.
- **Obmedzenia:**
  - učí sa na simulovanej histórii,
  - skener s menej ako 20 položkami za 30 min sa nehodnotí (mimo vlny),
  - pri ~1 položke za minútu je štatistika slabá, preto alarm príde až po niekoľkých hodinách poklesu. Pri vyššom objeme by prišiel skôr,
  - náhla porucha (výpadok) nie je pomalý pokles: tú hlási heartbeat (offline, ADR-026), nie tento model,
  - skóre je v pamäti procesu app, po reštarte sa obnoví do 5 simulovaných minút.

## 3. Brána: detekcia vozidiel a ŠPZ

*(Pripravuje sa.)*

## 4. IoT skener na nakládke

*(Pripravuje sa.)*
