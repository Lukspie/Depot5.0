# Použitie umelej inteligencie pri tvorbe Depot 5.0

> Pre koho: vyučujúci predmetu AISPU. Dokument opisuje, kde a ako sme pri projekte použili AI, aké zadania (prompty) dostala, čo rozhodoval tím a ako sa výsledky kontrolovali.

## 1. Zhrnutie

- Kód, testy a technickú dokumentáciu projektu písal **AI coding agent (Claude Code)** podľa zadaní, ktoré tím pripravoval a schvaľoval.
- Zadania (prompty), kontrolu plánov agenta, doménové spresnenia a vizuálnu maketu sme pripravovali v konverzácii s **Claude (Anthropic, model Claude Opus 5.5)** v aplikácii Claude.
- **Tím** určil tému, doménu (proces prekládkového depa podľa skúsenosti člena tímu z brigády v depe), požiadavky, schvaľoval plán a výsledok každej fázy, opravoval doménové chyby, robil rozhodnutia, zakladal Azure databázu, dodal reálne vstupy (fotky, krabice so štítkami) a testoval aplikáciu naživo.
- Každá fáza prešla automatickými testami, lintom, typovou kontrolou a nezávislou kontrolou AI reviewera. Všetky rozhodnutia sú zapísané ako ADR v [decisions.md](decisions.md).

## 2. Nástroje a roly

| Kto / čo | Úloha |
| --- | --- |
| **Tím** | doména, požiadavky, schvaľovanie plánov a výsledkov, doménové opravy, rozhodnutia o rozsahu, Azure účet a server, testovanie v aplikácii, schválenie dizajnu |
| **Claude** (chat, Opus 5.5) | písanie zadaní pre agenta, kontrola plánov a reportov agenta, upozornenia na chyby v logike, návrh pracovného postupu, vizuálna maketa digitálneho tieňa, návod na Azure |
| **Claude Code** (coding agent vo VS Code) | implementácia (Python FastAPI, Node.js TypeScript, React), migrácie, testy, ADR, vysvetlivky fáz, dokumentácia |
| **Subagent `reviewer`** | nezávislá kontrola zmien voči zadaniu a ADR pred commitom (agent, ktorý kód nepísal) |
| **Hooks** (`.claude/hooks/check.mjs`) | automatický lint po každej úprave súboru, typecheck a testy pred ukončením odpovede agenta, blokovanie mazania databázových volumes |

## 3. Pracovný postup

Projekt vznikal po **fázach** (§10 v [PROMPT.md](PROMPT.md) a [plan-doplnky.md](plan-doplnky.md)). Každá fáza mala rovnaký priebeh:

1. Agent si prečíta zadanie fázy, súvisiace ADR a poučenia a **navrhne plán**.
2. **Tím plán skontroluje** (s pomocou Claude) a schváli ho, prípadne ho upraví.
3. Agent implementuje. Hooks po každej úprave spúšťajú lint a pred koncom odpovede typecheck a testy.
4. Na konci fázy: testy všetkých služieb, `docker compose up --build`, screenshoty, vysvetlivka fázy (`docs/fazy/`), **reviewer**, commit.
5. Agent pošle zhrnutie a **čaká na potvrdenie** tímu.

Pamäť projektu pre agenta je v repozitári, nie v konverzácii:
- [`CLAUDE.md`](../CLAUDE.md): mapa projektu, príkazy, pravidlá a sekcia **Lessons learned**, do ktorej agent zapisuje chyby a opravy, aby sa neopakovali,
- `.claude/`: hooks, subagent `reviewer`, skill `/faza` (postup začiatku a konca fázy),
- [`decisions.md`](decisions.md): 59 ADR (kontext, rozhodnutie, dôsledok).

## 4. Hlavné zadanie

Základom je [docs/PROMPT.md](PROMPT.md). Pripravil ho tím s pomocou Claude z vlastných nápadov (sledovanie kamiónov, kamery na bráne, tabuľa ETA, skenovanie pri nakládke) a z podmienok predmetu. Obsahuje:

- §1 povinné podmienky od vyučujúceho,
- §2 doménu (cross-dock, večerná a nočná vlna, kaskáda meškania, problém s ručným skenovaním),
- §3 architektúru (kontajnery, komunikácia, bezpečnosť, simulované hodiny),
- §4 dátový model oboch databáz,
- §5–7 simulátor, sledovanie pre zákazníka, obrazovky a 3D pohľad,
- §8 štyri ML modely,
- §10 fázy a §11 pravidlá práce agenta.

Úpravy a rozšírenia, ktoré tím schválil počas práce, sú v [plan-doplnky.md](plan-doplnky.md).

## 5. Zadania po fázach

### Fázy 0–4 (25.–26. 10. 2026)
Prebehli v predchádzajúcej konverzácii s agentom. Zadaním bol `PROMPT.md`, agent po každej fáze čakal na schválenie. Výsledky sú v commitoch `b284ea3` až `45f1047` a vo vysvetlivkách `docs/fazy/faza-0` až `faza-4`. Doplnky schválené pri týchto fázach sú v `plan-doplnky.md`.

### Nastavenie pracovného postupu (26. 10.)
Claude pripravil `CLAUDE.md`, hooks, subagenta `reviewer` a skill `/faza` (commit `26f3d49`). Dohody zo staršej konverzácie, ktoré neboli v repozitári, sme preniesli týmto zadaním:
```
Zhrň dohody, plány a otvorené otázky z tohto chatu, ktoré NIE SÚ zapísané v depotrack/docs (PROMPT, decisions, plan-doplnky, fazy). Zapíš ich do depotrack/docs/plan-doplnky.md, alebo do depotrack/CLAUDE.md ak ide o pravidlo práce. Nič iné nemeň.
```

### Fáza 5 – digitálny tieň (26. 10.)
```
/faza 5
Najprv sprav body „Pred Fázou 5“ z docs/plan-doplnky.md ako samostatný commit, potom navrhni plán Fázy 5. Otvorené otázky z plan-doplnky zahrň do plánu s odporúčaním.
```
Schválenie plánu s doplneniami:
```
Plán schvaľujem vrátane všetkých odporúčaní z otvorených otázok. Doplnenia:
1. Commituj po krokoch: React 19 upgrade samostatne (s kontrolou všetkých obrazoviek), potom scéna+panely, potom what-if+akcie.
2. Kaskádu máme v Pythone aj TS – sprav spoločné testovacie prípady (JSON v repo), ktoré overí pytest aj vitest, aby sa vzorce nerozišli. Zapíš do ADR-047.
3. frameloop="demand": počas animácie balíkov volaj invalidate(), nech ParcelFlow nezamrzne.
4. Údržba nesmie odstrániť zaručený scenár degradácie skenera z predvoleného seedu – Fáza 6 ho potrebuje.
5. Kontrolu fps definuj konkrétne (nástroj + cieľ, napr. 60 fps pri 1440 px počas večernej vlny) a výsledok zapíš do docs/fazy.
```

### Fáza 5c – digitálny tieň v2 a reálne brány (26. 10. – 4. 11.)
Spätnú väzbu tímu (layout nezodpovedal referencii, reálne typy brán v depe podľa skúsenosti člena tímu) Claude zapísal do `plan-doplnky.md` ako Fázu 5c (commit `d15952f`). Zadania a schválenia:
```
Fázu 5 schvaľujem. Pokračuj /faza 5c podľa docs/plan-doplnky.md (pred 5b).
```
```
Plán 5c schvaľujem, začni 5c-1. Úpravy:
1. Brány modeluj dvoma poľami: door_drive (electric | manual) a dock_equipment (dock_leveler | telescopic_conveyor | none). Dočasný seed: LD-01–02 electric + dock_leveler (2 hlavné s rampou), LD-03–05 electric + telescopic_conveyor (plošina), LD-06–08 electric + none, kuriérske SB manual + none. Neskôr ho nahradí reálne rozloženie Budimíra.
2. door_sensor nesmie vstupovať do priemernej čítanosti v KPI, do device_metrics_minutely ani do dát pre prediktívnu údržbu (Fáza 6). Pokry to testom.
3. Pridaj *.glb binary do .gitattributes skôr, než commitneš prvý model. Limit ~2 MB OK.
4. V 5c-1 zmeň KPI „balíky dňa“ na „balíky v aktuálnej vlne“ podľa zadania a odstráň zápis o odchýlke.
5. Poloha hubu: súhlasím, presun do Ivanky len ak to pokryje cestná sieť.
```
```
5c-1 OK, pokračuj 5c-2. Najprv oprav KPI vlny: vlny sú definované v services/waves.py (večerná 15:30–22:00, nočná 01:00–06:00), nie polovice dňa. KPI ber z týchto vĺn; mimo vlny zobraz „mimo vlny“ a čas ďalšej vlny. Pridaj test na hranice (15:29, 15:30, 22:00, 01:00, 06:00, 10:00).
Reviewera spusti aj hneď po 5c-3 (migrácie + simulátor), nielen na konci 5c.
```
```
5c-2 OK. Pred 5c-3:
1. Over otvorenú bránu: skoč v simulácii na 15:30, zrýchli, počkaj na prvé kamióny a urob screenshot brány s kamiónom a balíkmi v otvore. Ak niečo nesedí, oprav to ešte v 5c-2.
2. V 5c-3 nech je zdrojom stavu brány v scéne aj v paneli door_sensor (otvorená/zatvorená/porucha). Kamión pri bráne je len vstup simulátora, ktorý stav senzora generuje. Pri poruche ukáž bránu neutrálne so štítkom „senzor – porucha“, nehádaj stav podľa kamióna.
Potom pokračuj 5c-3 a hneď po ňom reviewer.
```
```
Plán 5c-4 schvaľujem s úpravami:
1. Hub: hľadaj v OSM budovu s SPS v name/operator. Ak ju nenájdeš jednoznačne, NEHÁDAJ – vypíš mi 2–3 kandidátov (OSM id, súradnice, rozmery) a ostaň pri schematickej hale, kým nevyberiem.
2. Zmenu polohy/rozmerov hubu urob v migrácii AJ v seed/reference.py, nech čistý klon a existujúca DB skončia rovnako. Over testom z čistého klonu.
3. Kamión: ak Car Kit nemá ťahač s návesom v našej mierke, nechaj vlastný diel; z kitu ber dodávku, auto a krabice.
4. Krabice cez inštancie geometrie z GLTF (Instances/InstancedMesh), nie klony. 60 fps v záťažovom režime musí ostať.
5. Do LICENSE.txt zapíš presnú URL a verziu kitu.
6. Názov: v UI „Ivanka pri Dunaji“ s kontextom „hub Bratislava“, kód BAH ostáva.
Odpovede 1 a 2 z otvorených otázok OK.
```
3D modely (Kenney Car Kit 3.1 a Factory Kit 3.0, licencia CC0) sme stiahli ručne v prehliadači, lebo stránka automatické sťahovanie blokuje.

### Vizuálna maketa digitálneho tieňa (4. 11.)
Tím s výsledným vzhľadom nebol spokojný. Claude preto pripravil **maketu** obrazovky (layout, farby scény, uhol kamery) a tím ju schválil. Je v [design/maketa-tien/](design/maketa-tien/README.md) a slúži ako vizuálny cieľ pre úpravy UI.

### Fáza 5d – simulácia a testovanie (4.–6. 11.)
```
Nová Fáza 5d – Simulácia a testovanie (pred 5b). Najprv ju zapíš do docs/plan-doplnky.md, potom navrhni plán a počkaj na potvrdenie.

Problém: scenár „čo ak“ v praxi veľmi nefunguje, testovať konkrétne situácie je pracné (čakanie na 15:00, skoky bez dát) a v areáli sa nahromadilo 260+ aktívnych alarmov.

0. Diagnóza ako prvý krok, bez opráv: zisti, prečo scenár nefunguje. Over ho v rôznych časoch (10:00, 15:45, 18:30, 02:00, 05:45) a so všetkými typmi zásahov. Výsledky daj do tabuľky (čas, zásah, očakávané, skutočné, príčina) a zastav sa.
1. Ovládanie času: skok na ľubovoľný čas HH:MM, režimy „preskočiť“ a „pretočiť s dátami“, pauza a krok +5 / +15 / +60 min, „čistý reset dňa“.
2. Situácie: pomenované deterministické predvoľby (seed + čas + vložené udalosti), dostupné v admine, cez API a cez URL (?situation=evening-peak).
3. Vkladanie incidentov do živej simulácie (meškanie jazdy, porucha skenera, zlý smer, neznáma ŠPZ, porucha senzora dverí, nezastihnutí zákazníci).
4. Oprava scenára „čo ak“: funguje v každom čase, výber zo zoznamov, tabuľka plán vs. scenár, golden testy.
5. Hygiena alarmov: deduplikácia a automatické uzatváranie vyriešených alarmov.
6. E2E testy: Playwright na hostovi, nie nový kontajner (ostávajú 4).

Pravidlá: ovládanie simulácie len pre admina; v ostrom režime sa vypína premennou SIM_CONTROLS_ENABLED. Determinizmus simulátora ostáva. ADR pre situácie, režimy skoku a e2e. Commit po krokoch, reviewer po krokoch 1–4.
```
*(Zadanie je skrátené, body 1–6 boli v pôvodnom prompte rozpísané podrobnejšie.)*

Schválenie plánu:
```
Plán 5d schvaľujem s defaultmi z otvorených otázok. Doplnenia:
1. Replay: najprv zmeraj, kde je úzke hrdlo. Preferuj dávkový interný endpoint v app (hromadný insert) pred štartovacou snímkou. Snímku len ako automatickú cache s kľúčom (seed, situácia, verzia kódu), nie ako ručne udržiavaný súbor.
2. E2E /track: token si vytiahni po načítaní situácie z admin API notifikácií. Tokeny nerob deterministické (ADR-042).
3. Krok +N min a replay o N min musia byť rovnaký kód. Test: step 60 == replay 60 (rovnaké skeny).
4. README: veta, že v ostrom režime sa nastavuje SIM_CONTROLS_ENABLED=false.
5. Do commitu kroku 0 zahrň aj necommitnuté docs (plan-doplnky, CLAUDE.md, README, docs/design/maketa-tien/).
Pokračuj krokom 0 a zastav sa.
```
Po diagnóze ([faza-5d-diagnoza.md](fazy/faza-5d-diagnoza.md)):
```
Diagnóza OK, díky. Pred krokom 1:
a) Hotfix 400 (rate, tripId): oprav validáciu (discriminator podľa typu zásahu alebo removeAdditional=false pre túto routu) + HTTP test pre každý z 5 typov zásahu. Samostatný commit.
b) Do Lessons learned a checklistu reviewera: „každý variant API schémy má aspoň jeden test cez HTTP, nielen test výpočtu“.
Potom krok 1.
Do kroku 4 zapíš do plan-doplnky:
- oneskorený prechod = odchod > 15 min po pláne (prah v konfigurácii),
- panel ukazuje rezervu do závislých odchodov („rezerva 3 h 05 min“),
- nové KPI: meškanie diaľkových odchodov a balíky, ktoré nestihnú svoj odchod,
- výber jazdy ukazuje predikovaný čas (nočný BA ~06:05), prebehnuté jazdy sa v zozname nezobrazujú.
Do kroku 2 pridaj situáciu calm-night bez kaskád v pláne, nech scenár ukáže vznik kaskády.
```

### Fáza 6 (ML) a minimálna Fáza 7
```
- 5d: dokonči len hotfix 400, krok 1 (ovládanie času), krok 2 (situácie vrátane calm-night) a z kroku 5 len uzavretie starých alarmov a KPI len pre aktuálny deň. Kroky 3, 4 (okrem prahu 15 min) a 6 presuň do „Po odovzdaní“.
- Potom Azure, potom Fáza 6, v nedeľu minimálna Fáza 7. Z 5b len oprava poradia zastávok na /courier. Zvyšok 5b presuň do „Po odovzdaní“.

AZURE (nová požiadavka učiteľa: jedna DB v Azure, druhá podľa výberu)
- db-telemetry pôjde do Azure Database for PostgreSQL Flexible Server (B1MS, PG 16). Server vytvára používateľ sám, ty pripravíš nastavenie a návod v README (portal aj az CLI, firewall, sslmode=require).
- Telematika sa pripája cez TELEMETRY_DATABASE_URL so SSL. Migračný runner (ADR-012) musí prejsť aj proti Azure. Hodnoty len v .env, do .env.example placeholder.
- Kontajner db-telemetry ostáva ako záloha cez compose profil `local` (offline demo a testy). Predvolený režim = Azure. ADR-056.
- Over: telematika beží proti Azure, skeny pribúdajú, /system ukazuje DB Azure ako healthy, latencia nebrzdí simuláciu (dávky zápisov).

FÁZA 6 – ML (podľa PROMPT §8, poradie = priorita, každá časť má časový limit)
1. Predikcia meškania kamiónov: HistGradientBoostingRegressor na histórii z generátora. Metrika MAE v minútach vs. baseline (priemer na smer). Inferencia v app → predicted_arrival pre tabuľu ETA a kaskádu.
2. Prediktívna údržba skenerov: IsolationForest nad device_metrics_minutely (bez door_sensor). Úloha každých 5 sim. minút, prah → alarm. Musí zachytiť zaručenú degradáciu zo seedu (test). Skóre rizika v paneli zariadenia.
3. Brána (CV): predtrénovaný detektor vozidiel v ONNX + OCR ŠPZ nad onnxruntime, slovenská ŠPZ overená regexom. Bez torch v image app, ak sa dá. POST /api/gate/detect, obrazovka /gate, ml/gate_video.py na hostovi. Licencie modelov zapíš.
4. IoT skener na nakládke (prototyp): ml/dock_scanner.py na hostovi, QR/čiarové kódy, počítanie krabíc prechodom cez čiaru, skript na tlač štítkov skutočných balíkov dňa.
- Artefakty v ml/artifacts, tréning jedným príkazom, ml/README.md pre každý model (dáta, príznaky, metriky, obmedzenia). Testy cez HTTP. Reviewer na konci.

NEDEĽA – minimálna Fáza 7
- docs/architektura.md (mermaid), docs/api.md, docs/demo.md, aktualizovaný README, docs/fazy/faza-6-ml.md.
- Kontrola z čistého klonu (bez mazania volumes) a screenshoty v situácii evening-peak.

Commituj po častiach, nepushuj. Po každej časti mi daj krátke zhrnutie a pokračuj. Zastav sa len pri blokujúcom probléme alebo keď budeš potrebovať Azure údaje.
```
*(Zadanie je mierne skrátené, v pôvodnom prompte boli niektoré body podrobnejšie.)*

Azure server (Azure for Students, región Austria East podľa politiky povolených regiónov, Burstable B1ms v bezplatnej ponuke) vytvoril člen tímu ručne v portáli. Agent k nemu pristupuje len cez `TELEMETRY_DATABASE_URL` v `.env`, ktorý nie je v repozitári.

### Fáza 7b – demo (7. 11.)
Posledné úpravy pred odovzdaním. Tím zadal 5 bodov v poradí priority, po každom bode commit a reviewer po bodoch 1, 2 a na konci:
1. **Brána:** model len odporúča (typ vozidla, ŠPZ), identitu určí databáza vozového parku a povolených ŠPZ, pri neistote rozhodne ochranka. Front rozhodnutí na `/gate`, audit (kto, kedy, prečo), mix prejazdov zo simulátora, poctivé vyhodnotenie modelu.
2. **Kuriér:** `/courier` ako mobilná appka (rám telefónu na PC), simulovaný Bluetooth skener spárovaný s dodávkou, typy doručenia (osobne s časovým oknom, schránka, box), poradie zastávok s oknami, oprava neaktívneho „Doručené“ pred nakládkou, prístup z telefónu v rovnakej Wi-Fi.
3. **Dispečeri:** 3 účty po zmenách. 4. **Ranná nakládka** od 6:30, dodávky stoja v areáli v tieni aj vo Flotile. 5. **Layouty skladov** (ak ostane čas).

Vzniklo ADR-061 až 063, body 1–4 sú hotové. Bod 5 tím presunul po odovzdanie. Agent v OSM našiel kandidáta na sklad Žilina, ale budovu nehádal. Reviewer zachytil napríklad to, že vytlačená ŠPZ bez vozidla otvorila bránu, a meranie trás len na 16 trasách namiesto všetkých 648. Obe chyby sú opravené (ADR-061, ADR-062).

## 6. Čo rozhodol a opravil tím (príklady)

| Situácia | Čo urobil tím |
| --- | --- |
| Terminológia 3D pohľadu | na základe pripomienky cvičiaceho: „digitálny tieň“ namiesto „digitálne dvojča“ (ADR-045) |
| Typy brán | podľa skúsenosti z depa: 2 hlavné brány s rampou, 3 na plošine s vysúvacím pásom, kuriérske brány na lanko. Agent pôvodne navrhol 5 brán s rampou, tím to opravil |
| KPI „balíky vo vlne“ | AI rozdelila deň na polovice. Tím trval na skutočných vlnách (15:30–22:00, 01:00–06:00) |
| Dizajn | tím odmietol prvú verziu tieňa a schválil novú maketu |
| Scenár „čo ak“ | tím si vyžiadal diagnózu pred opravami. Odhalila chybu validácie API a nevhodné KPI |
| Prah meškania | tím určil, že oneskorený prechod je až nad 15 min |
| Hub Bratislava | pravidlo „nehádať budovu“: použila sa len budova jednoznačne označená v OSM |
| Termín | tím zúžil rozsah a určil poradie: ML pred dizajnom |
| Azure | voľba databázy (telemetria), vytvorenie servera, kontrola nákladov (bezplatná ponuka) |

## 7. Kontrola kvality

- **Automatické testy:** 171 testov hlavného backendu (pytest) a 123 testov telematiky (vitest), lint (ruff, eslint) a typy (mypy strict, strict TypeScript). Stav k 7. 11. 2026 po Fáze 7b.
- **Hooks:** lint po každej úprave, typecheck a testy pred koncom každej odpovede agenta.
- **Reviewer:** po každej fáze. Našiel napríklad rozsah dôveryhodných proxy, ktorý by umožnil obísť limit prihlásení, skeny prichádzajúce do WMS až po odchode kamióna, model meškania bez zimných dát alebo chybný štart simulácie na novej Azure DB. Všetky blokujúce nálezy sú opravené.
- **Test z čistého klonu** pred odovzdaním a ručné overenie hlavných scenárov v aplikácii.

## 8. Obmedzenia a incidenty

- Vizuálny dizajn navrhnutý priamo v kóde nezodpovedal predstave tímu. Pomohlo až oddelenie dizajnu (maketa) od implementácie.
- Časť funkcií je presunutá do „Po odovzdaní“ (incidenty v živej simulácii, e2e testy, UX review). Zoznam je v `plan-doplnky.md`.
- Pri sťahovaní testovacej fotografie z Wikimedie agent omylom poslal e-mail člena tímu v hlavičke User-Agent. Agent to sám nahlásil a do pravidiel pribudol zákaz posielať osobné údaje externým službám.
- AI nemala prístup k heslám: `.env` nie je v repozitári a Azure účet aj server vytvoril človek.

## 9. Kde nájsť podrobnosti

| Čo | Kde |
| --- | --- |
| Hlavné zadanie | [PROMPT.md](PROMPT.md) |
| Schválené doplnky a zmeny plánu | [plan-doplnky.md](plan-doplnky.md) |
| Rozhodnutia (ADR) | [decisions.md](decisions.md) |
| Vysvetlivky fáz a otázky na obhajobu | [fazy/](fazy/) |
| Pamäť a pravidlá agenta | [`CLAUDE.md`](../CLAUDE.md), `.claude/` |
| História zmien | `git log` (každá fáza = commit `feat: phase N – …`) |
