# ML modely Depot 5.0 (Fáza 6)

> Pre koho: kto píše kapitolu dokumentácie o ML, alebo model pretrénuje. Ku každému modelu: dáta, príznaky, metriky, obmedzenia. Rozhodnutia sú v ADR-057 a ďalších.

**Všetko jedným príkazom** (z koreňa repozitára, beží stack): `sh ml/train_all.sh`. Pregeneruje históriu, natrénuje oba modely v image app a overí model brány. Potom `docker compose build app`.

Artefakty sú v `ml/artifacts/` a app ich načíta pri štarte (sú skopírované do image). Ak artefakt chýba alebo bol uložený inou verziou scikit-learn, app naštartuje bez modelu a `/system` ukáže „model nedostupný“.

## Príprava dát

História sa generuje rovnakými modelmi meškania a čítanosti ako živý simulátor (deterministicky, seed 42):

```bash
cd telematics
npm run gen:history -- --out ../ml/data
```

Predvolene je to 400 dní s pevným koncom 31. 12. 2026, takže každé spustenie dá rovnaké dáta a zima so snehom je v nich. Výstup (v `.gitignore`, ~30 MB):
- `ml/data/trips_history.csv`: 6 400 udalostí jázd (400 dní × 16), počasie jasno 4 240, dážď 1 296, sneh 592, hmla 272,
- `ml/data/device_metrics_history.csv`: 600 000 minútových metrík skenerov (91 epizód degradácie) s označenými epizódami degradácie (objem ako v živom simulátore: ~1 položka/min na bránu).

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
  | `weekday`, `month`, `hour` | deň v týždni (0 = nedeľa … 6 = sobota), mesiac (sezóna), hodina plánovanej udalosti, miestny čas |
  | `weather` | simulované počasie dňa (jasno, dážď, hmla, sneh) z telematiky |
  | `prev_delay_min` | meškanie tej istej jazdy predchádzajúci deň |

  Vzdialenosť trasy je pre smer konštantná, preto ju pokrýva smer.
- **Rozdelenie:** podľa času, posledných 30 dní (december, aj sneh) je test (480 udalostí), 370 dní tréning (5 920). Po vyhodnotení sa model pretrénuje na všetkých dňoch.
- **Výsledok (dáta 27. 11. 2025 – 31. 12. 2026):**

  | | MAE modelu | MAE baseline (priemer na smer a druh) |
  | --- | --- | --- |
  | všetky udalosti | **7,19 min** | 15,29 min (−53 %) |
  | príjazdy | **11,21 min** | 25,30 min (−56 %) |
  | odjazdy | **3,16 min** | 5,28 min (−40 %) |

  Prínos je hlavne pri príjazdoch: v zime počasie (sneh) a meškanie predchádzajúceho dňa vysvetľujú veľkú časť rozptylu, čo priemer na smer nevie.
- **Oprava po review:**
  - prvá verzia sa učila len na máji až novembri, bez snehu, a sneh predpovedala ako jasno,
  - tréning a inferencia mali deň v týždni posunutý (0–6 oproti 1–7),
  - dnes test mení vždy len jeden príznak a kontraktný test overuje kódovanie dňa.
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
- **Výsledok (posledných 45 dní histórie):**

  | Metrika | Hodnota |
  | --- | --- |
  | zachytené epizódy degradácie | **12 z 12** |
  | presnosť bucket-ov s alarmom (precision) | 0,92 |
  | recall bucket-ov s viditeľným poklesom (≥ 4 body pod normálom) | 0,70 |
  | falošné alarmy na zdravých bucket-och | 0,49 % (pri 8 skeneroch zhruba 1 falošný alarm denne) |
  | medián oneskorenia od začiatku epizódy | 24 h (epizódy trvajú 6–48 h a prechádzajú viac vĺn) |

- **Zaručená degradácia zo seedu** (`SIM_DEGRADED_DEVICE`, 0,97 → 0,85 za 6 h od 15:30, ADR-024): vo večernej vlne svojej brány (17:05–21:15) pri živom objeme spustí alarm pred koncom vlny pri čítanosti ~0,87 (naživo LD-02 o 21:10). Zdravé skenery (0,93–0,97 so šumom) alarm nespustia. Overuje to `app/tests/test_ml.py`.
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

**Príprava modelu** (jednorazovo, výsledok je v repozitári):

```bash
python ml/download_gate_models.py     # ml/artifacts/yolox_tiny.onnx (19 MB)
```

- **Úloha:** z jednej fotky z kamery brány zistiť typ vozidla (kamión, osobné auto, autobus) a slovenskú ŠPZ, zapísať prejazd a pri neznámej ŠPZ otvoriť alarm.
- **Modely** (bez dotrénovania, bez torch v image, všetko na onnxruntime CPU):

  | Časť | Model | Licencia |
  | --- | --- | --- |
  | detekcia vozidiel | **YOLOX-Tiny** (Megvii), ONNX export autorov, COCO (car, motorcycle, bus, truck), vstup 416 × 416 | Apache-2.0 |
  | text ŠPZ | **RapidOCR** (`rapidocr-onnxruntime`): detekcia a rozpoznanie textu modelmi PaddleOCR v ONNX | Apache-2.0 |

  Ultralytics YOLOv8 navrhovaný v PROMPT §8 je **AGPL-3.0**. Pri nasadení ako služba by sme museli zverejniť zdrojový kód celej aplikácie, preto sme zvolili YOLOX s Apache-2.0 (ADR-059).
- **Postup** (`app/src/depotrack/ml/gate.py`):
  1. YOLOX nájde vozidlá (skóre ≥ 0,35, NMS 0,45),
  2. OCR číta text v najväčšom vozidle, alebo v celej fotke, ak vozidlo nenájde (detail tabuľky),
  3. z textu sa vyberie slovenská ŠPZ `AA-123BB`. Typické zámeny OCR (O/0, I/1, B/8, S/5, Z/2) sa opravia podľa pozície, najviac 2, a v strede musia byť aspoň 2 skutočné číslice.
- **API:**
  - `POST /api/gate/detect?direction=in|out&record=true` (ochranka, admin), telo je obrázok JPEG, PNG alebo WebP do 8 MB,
  - odpoveď: vozidlá s istotou a rámikom, typ, ŠPZ s istotou, prečítaný text a či ide o vozidlo flotily (tabuľka `vehicles`),
  - s `record` ide prejazd do telematiky (`POST /internal/gate/passages`, dvor v digitálnom tieni) a neznáma ŠPZ otvorí alarm „Neznáma ŠPZ na bráne“.
- **Obrazovka `/gate`** (ochranka): nahratie alebo odfotenie (na mobile priamo fotoaparát), rámik vozidla, výsledok a živé prejazdy z kamery.
- **Video:** `ml/gate_video.py` na hostovi (`pip install -r ml/requirements-host.txt`) berie snímku každú sekundu videa alebo webkamery. Novú ŠPZ zapíše raz za minútu.

  ```bash
  DEPOT_PASSWORD=<heslo ochranky> python ml/gate_video.py video.mp4   # alebo --camera 0
  ```
- **Overenie:**
  - CC0 fotka návesu (`app/tests/data/gate_truck_cc0.jpg`): kamión s istotou 0,86. Ruský nápis na kabíne nie je ŠPZ, výsledok je „nečitateľná“, čo je správne,
  - syntetická tabuľka `KE-102LH`: prečítaná s istotou 0,96,
  - celé demo video (kamión, ŠPZ flotily, neznáma ŠPZ): 3 prejazdy, 1 alarm,
  - čas na CPU: 0,8–1,3 s na fotku.
- **Obmedzenia:**
  - na reálnych fotkách zo SPS ani na tme a v daždi to nie je overené (nemáme dáta),
  - OCR modely sú všeobecné (latinka a čínština), nie špecializované na ŠPZ,
  - tabuľka musí mať aspoň ~60 px na výšku,
  - image app narástol na ~1,7 GB (OpenCV, onnxruntime).

## 4. IoT skener na nakládke (prototyp)

**Na obhajobe:** webkamera (alebo mobil ako IP kamera) nad „pásom“ a krabice s vytlačenými štítkami.

```bash
pip install -r ml/requirements-host.txt
# 1. štítky reálnych balíkov, ktoré sa práve nakladajú pri bráne (najprv situácia, napr. morning-departures)
DEPOT_PASSWORD=<heslo dispečera> python ml/labels.py --door LD-06 --count 16 --out labels.pdf
# 2. skener brány LD-06; v .env SIM_EXTERNAL_DEVICES=DOCK-SCN-06, aby ho nesimuloval simulátor
SERVICE_TOKEN=<z .env> python ml/dock_scanner.py --device DOCK-SCN-06 --camera 0 --show
# skúška bez systému: python ml/dock_scanner.py video.mp4 --dry-run
```

- **Úloha:** reálne „IoT zariadenie“ namiesto simulovaného skenera. Spočíta krabice, prečíta ich kódy a pošle skeny rovnakým API ako simulátor.
- **Postup** (`ml/dock_scanner.py`, OpenCV na hostovi, nič netreba trénovať):
  1. **Počítanie krabíc:** odčítanie pozadia (MOG2), uzavretie dier po štítku (25 × 25), kontúry od 1 % plochy obrazu, vnorené rámiky sa zlúčia. Ťažiská sa sledujú medzi snímkami (najbližší sused). Krabica, ktorú bolo vidieť aspoň 3 snímky a prejde čiarou (predvolene 60 % výšky), je jedna položka.
  2. **Kódy:** `cv2.QRCodeDetector` (viac QR naraz) a `cv2.barcode` (EAN, Code128…) v každej snímke. Kód sa priradí krabici, v ktorej rámiku leží. Pri prechode čiarou platí najčastejší kód, inak je krabica nečitateľná.
  3. **Sken:** `POST /devices/{kód}/scans` v telematike (`{barcode, readOk, itemCounted: true}`, service token), heartbeat každých 10 s. Telematika ho spracuje ako simulovaný sken: kontrola smeru a nakládka vo WMS, alarm zlého smeru, čítanosť zariadenia, minútové metriky pre prediktívnu údržbu.
- **YOLO na krabice sme nedotrénovali** (PROMPT §8.2 to pripúšťa). Nemáme vlastné označené snímky a odčítanie pozadia pri pevnej kamere a jednej dráhe stačí. Obmedzenia sú v ADR-060.
- **Štítky** (`ml/labels.py`): stránky A4 s 8 štítkami (QR kód čiarového kódu, text, brána, smer, hmotnosť). Balíky berie z `GET /api/shadow/doors/{brána}`, čo sú chýbajúce balíky jazdy, ktorá pri bráne práve nakladá. QR sa generuje cez OpenCV a PDF cez Pillow, nové závislosti netreba.
- **Overenie (7. 11. 2026):**
  - syntetické video 6 krabíc (4 s QR, 2 bez kódu): 6 spočítaných, 4 prečítané,
  - naživo v situácii `morning-departures` pri LD-06 (smer HE): 5 krabíc, z toho 4 so štítkami reálnych balíkov. Spočítaných 5, prečítané 4 a vo WMS kleslo „chýba naložiť“ z 32 na 28 a všetky 4 balíky sú naložené,
  - prvá verzia rátala krabicu so štítkom dvakrát (štítok rozdelil kontúru). Opravilo to uzavretie dier, zlúčenie vnorených rámikov a minimálny vek stopy.
- **Obmedzenia:**
  - pevná kamera a pokojné pozadie (MOG2 sa učí pozadie prvé sekundy),
  - krabice idú jedna po druhej, dve dotýkajúce sa sa zlejú do jednej,
  - kód musí byť na snímke dosť veľký (QR ~80 px a viac),
  - test na skutočnom páse a s reálnou kamerou ešte nebol, ostáva na demo s krabicami.
