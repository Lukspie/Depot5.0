# Fáza 2 – telematika a simulátor

> Pre koho: členovia tímu a príprava na obhajobu. Čo vzniklo, kde to nájdeš a prečo je to tak.

## Čo vzniklo

Druhý backend (Node.js + TypeScript) teraz **simuluje celé depo**:

- **Simulované hodiny:** 60× rýchlejšie, štart o 15:00. Dajú sa pozastaviť, zrýchliť a preskočiť na 15:30, 01:00 alebo 06:00.
- **Kamióny:** jazdia po trasách medzi Košicami a cieľovými mestami a vznikajú im meškania (piatok, december, počasie, predchádzajúca jazda).
- **IoT skenery pri nakládkových bránach a na linke:**
  - spočítajú každý balík, aj keď štítok neprečítajú,
  - ~0,5 % balíkov príde k zlej bráne,
  - jeden skener postupne stráca čítanosť.
- **Ďalšie zariadenia:**
  - kamera na bráne (prejazdy kamiónov a občas cudzie osobné auto),
  - 3 senzory linky (rýchlosť pásu, teplota motora, vyťaženie),
  - heartbeat zariadení každých 10 s.
- **Prepojenia:**
  - **WebSocket** pre prehliadač s ticketom z app,
  - **REST medzi backendmi:** plán jázd z app, hlásenie priebehu jázd späť, alarmy.
- **Kaskádové varovanie v app:** keď nočný kamión mešká tak, že ohrozí ranný odchod regionálneho kamióna.
- **Ďalšie úlohy:**
  - **GDPR úloha** maže staré prejazdy bránou,
  - **generátor histórie** (`npm run gen:history`) vyrobí 6 mesiacov dát na tréning ML.

Na stránke **Stav systému** je nová karta „Živá simulácia“: hodiny a počty udalostí prichádzajúcich cez WebSocket.

## Ako to spolu komunikuje

```
                 (1) POST /api/auth/ws-ticket  (session cookie)
prehliadač ───────────────────────────────────────────────► app ──► db-wms
    │  ◄──────────── ticket (JWT, 60 s, rola) ───────────────┘        ▲
    │                                                                  │ (4) kaskáda → alerts
    │ (2) ws://telematics/ws?ticket=…   (kontrola Origin + ticket)     │
    └────────────────────────────────────► telematics ──► db-telemetry │
           ◄── dávky udalostí max 4×/s ───┘   │  (3) GET /internal/plan, /internal/manifest
                                              │      POST /internal/events/trips, /internal/alerts
                                              └──────────── X-Service-Token ──────────────► app
                                     app ── POST /internal/broadcast (alarmy do WebSocketu) ──► telematics
```

- **(1)–(2)** Frontend spája oba backendy: od app dostane ticket a s ním sa pripojí priamo na telematiku. Cookie session nikdy neopustí app.
- **(3)** App je zdroj pravdy pre jazdy a balíky. Telematika si od nej berie **plán dňa** (16 jázd) a **manifesty** (čiarové kódy balíkov podľa smeru) a hlási, ako sa jazdy vykonávajú.
- **(4)** App z predikcie príchodu nočného kamióna vyhodnotí kaskádu, uloží alarm a cez telematiku ho pošle všetkým pripojeným prehliadačom.

## Kde to je v kóde

| Čo | Súbor |
| --- | --- |
| Simulované hodiny, časové pásmo (aj zmena času) | [telematics/src/clock/](../../telematics/src/clock/) |
| Deterministická náhoda | [simulator/rng.ts](../../telematics/src/simulator/rng.ts) |
| Model meškaní (zdieľaný s generátorom histórie) | [simulator/delays.ts](../../telematics/src/simulator/delays.ts) |
| Scenár dňa: meškania, porucha, cudzie autá | [simulator/scenario.ts](../../telematics/src/simulator/scenario.ts) |
| Stav jazdy v čase, poloha na trase, ETA | [simulator/trips.ts](../../telematics/src/simulator/trips.ts) |
| Trasy | [simulator/routes.ts](../../telematics/src/simulator/routes.ts), [data/routes.json](../../telematics/data/routes.json) |
| Skenery, čítanosť, degradácia | [simulator/scanners.ts](../../telematics/src/simulator/scanners.ts) |
| Engine (tik 250 ms, zápisy, hlásenia do app) | [simulator/engine.ts](../../telematics/src/simulator/engine.ts) |
| WebSocket: ticket, hub s dávkovaním, upgrade | [telematics/src/ws/](../../telematics/src/ws/) |
| REST API: ovládanie simulácie, zariadenia, broadcast | [telematics/src/api/](../../telematics/src/api/) |
| Zápisy do db-telemetry | [db/telemetry.ts](../../telematics/src/db/telemetry.ts), [sql/003_sim_state.sql](../../telematics/sql/003_sim_state.sql) |
| GDPR úloha | [jobs/retention.ts](../../telematics/src/jobs/retention.ts) |
| Generátor histórie | [scripts/gen-history.ts](../../telematics/src/scripts/gen-history.ts) |
| App: plán jázd | [services/trip_plan.py](../../app/src/depotrack/services/trip_plan.py) |
| App: interné API pre telematiku | [api/internal.py](../../app/src/depotrack/api/internal.py) |
| App: kaskáda a alarmy | [services/cascade.py](../../app/src/depotrack/services/cascade.py), [services/alerts.py](../../app/src/depotrack/services/alerts.py) |
| App: WS ticket | [core/tickets.py](../../app/src/depotrack/core/tickets.py), `POST /api/auth/ws-ticket` v [api/auth.py](../../app/src/depotrack/api/auth.py) |
| Frontend: WebSocket s automatickým znovupripojením | [api/telematicsSocket.ts](../../frontend/src/api/telematicsSocket.ts), [hooks/telematics.tsx](../../frontend/src/hooks/telematics.tsx) |

## Prečo je to tak navrhnuté

- **Prečo je simulátor deterministický?** Celý deň (meškania, porucha, ktorý balík príde k zlej bráne, čítanosť skenerov) sa vypočíta dopredu ako **čistá funkcia seedu a plánu**. Engine ho potom len „prehráva“ podľa hodín. Každé náhodné rozhodnutie má vlastný prúd náhody (napr. `seed|deň|trip|BA|inbound`), takže výsledok nezávisí od toho, či tik trvá 250 ms alebo minútu. Demo sa dá zopakovať a dá sa otestovať.
- **Prečo je kaskáda v predvolenom scenári zaručená?** Pri `SIM_FORCE_CASCADE=true` sa jednému nočnému kamiónu „pokazí“ auto na trase, a to presne tak dlho, aby príchod + 30 min triedenia prekročil ranný odchod závislého prechodu. Pri seede 42 ide o kamión **z Bratislavy**: porucha o 23:47, príchod 05:35 namiesto 01:30, ohrozené sú **Michalovce a Humenné** (odchod 06:00). Prechod v simulácii naozaj počká.
- **Prečo plán jázd vytvára app, a nie simulátor?** Zadanie hovorí, že app je zdroj pravdy pre jazdy. Simulátor je „svet vonku“: kamióny jazdia a skenery skenujú, ale čo sa *malo* stať, určuje app.
- **Prečo WebSocket s ticketom?** Prehliadač nemôže poslať session cookie na iný origin. Ticket je krátky (60 s), podpísaný zdieľaným tajomstvom, nesie rolu a dá sa použiť len raz, takže ak unikne z logu, je bezcenný. CORS sa na WebSocket nevzťahuje, preto telematika navyše kontroluje hlavičku `Origin`.
- **Prečo dávky max 4×/s?** Pri 60× rýchlosti chodí desiatky skenov a polôh za sekundu. Hub posiela každému klientovi najviac jednu správu za 250 ms. Polohy vozidiel a stav hodín sa „zlučujú“ (posiela sa len posledná hodnota), skeny idú do fronty s limitom, aby pomalý prehliadač nezahltil server.
- **Prečo heartbeat v reálnom čase?** Výpadok zariadenia je technický stav. Pri 60× rýchlosti by „30 s bez heartbeatu“ trvalo pol sekundy. Takto vypnutý skener zmizne po pol minúte bez ohľadu na rýchlosť.
- **Prečo skok hodín negeneruje preskočené skeny?** Skok z 15:00 na 01:00 je „pretočenie“. Stavy jázd sa prepočítajú, ale 10 hodín skenov naraz by nemalo význam.
- **Prečo sa stav simulácie ukladá do DB?** Aby reštart kontajnera nevrátil čas na 15:00 a stavy jázd v app necúvli.

## Ako to overiť

Pozri sa na kartu „Živá simulácia“ na http://localhost:8000. Simuláciu ovláda admin cez Swagger (http://localhost:8080/docs) alebo cez curl:

```bash
# 1) ticket pre admina (cez prihlásenú session v app)
curl -c c.txt -H 'Origin: http://localhost:8000' -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"admin-demo-2026"}' localhost:8000/api/auth/login
T=$(curl -s -b c.txt -X POST -H 'Origin: http://localhost:8000' localhost:8000/api/auth/ws-ticket | jq -r .ticket)

# 2) ovládanie hodín (ticket platí 60 s)
curl -X PUT  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"speed":600}' localhost:8080/sim/clock/speed
curl -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"to":"23:00"}' localhost:8080/sim/clock/jump
curl -H "Authorization: Bearer $T" localhost:8080/sim/scenario          # meškania, porucha, degradácia
curl -X PUT  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"enabled":false}' localhost:8080/sim/devices/DOCK-SCN-05
curl -X POST -H "Authorization: Bearer $T" localhost:8080/sim/restart-day   # deň znova od 15:00
```

Kaskádové alarmy sú v db-wms (DBeaver, `localhost:5433`): `SELECT * FROM alerts`.

Testy: `cd telematics && npm test` (53 testov) a `docker compose run --rm app pytest` (50 testov).

## Možné otázky na obhajobe

- *Ako viete, že sa pri rovnakom seede deň naozaj zopakuje?* Test `engine.test.ts` pustí dva enginy s rovnakým seedom a rôznou veľkosťou tiku a porovná všetky skeny. Musia byť identické. Iný seed dá iné dáta.
- *Čo sa stane, keď app nebeží?* Telematika beží ďalej. Plán dňa skúša načítať každých 5 s a nehlásené zmeny jázd drží v pamäti a pošle ich, keď sa app vráti (test „keeps retrying when the app is down“).
- *Ako sa vypočíta predikcia príchodu?* Teraz ju vie simulátor. Do odchodu je bez predikcie, od odchodu platí normálny čas príchodu, po poruche skutočný neskorší čas. Vo Fáze 6 ju pred odchodom doplní ML model (gradient boosting na dátach z `gen:history`).
- *Prečo sú skenery „spočítané“ aj bez prečítania štítku?* To je jadro motivácie projektu. Kamera vždy vidí, že balík prešiel, aj keď štítok nie je čitateľný. Systém preto vie, *koľko* balíkov je v kamióne, aj keď nevie *ktoré*.
- *Čo robí GDPR úloha?* Každú hodinu zmaže prejazdy bránou (ŠPZ, snímky) staršie ako `GATE_RETENTION_DAYS` (30 dní) aj s ich súbormi.
