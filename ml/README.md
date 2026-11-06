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
- `ml/data/device_metrics_history.csv`: 270 000 minútových metrík skenerov s označenými epizódami degradácie.

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

*(Pripravuje sa, IsolationForest nad `device_metrics_minutely`.)*

## 3. Brána: detekcia vozidiel a ŠPZ

*(Pripravuje sa.)*

## 4. IoT skener na nakládke

*(Pripravuje sa.)*
