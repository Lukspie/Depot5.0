# Fáza 7d – UI/UX v2, sieť skladov a vnútro skladu

> Pre koho: členovia tímu, ktorí budú Fázu 7d obhajovať, a reviewer. Porovnanie každej obrazovky s maketou (tabuľky ✓/✗ a screenshoty vedľa makety) je v [faza-7d-ui.md](faza-7d-ui.md).

## Čo vzniklo

- **Design systém v2** (ADR-067): tokeny farieb a rádiusov, komponenty v `frontend/src/components/ui` (karty KPI, stavy, segmenty, menu, dialóg, tabuľka so skupinami, časová os dňa). Nová bočná lišta s menu podľa roly a horná lišta s prepínačom skladu, hľadaním `Ctrl K`, vlnou, hodinami a alarmami.
- **Sieť skladov** (ADR-068): každý používateľ má domovský sklad. Dispečer a administrátor môžu sklady prepínať, ostatní vidia len svoj. Rozhoduje backend (`services/depot_scope.py`, 403/404), frontend len skrýva.
- **Login** podľa makety: tmavý panel so sieťou skladov z databázy, stavy chýb, zabudnuté heslo (len vysvetlenie, reset robí administrátor) a demo účty (len mená a roly, heslá nikdy cez API). Login je interný systém len pre zamestnancov.
- **Dispečing** (ADR-069): pohľad počíta server (`/api/dispatch`). Budimír má vlny, kaskády a odchody, Žilina a Ivanka časovú os depa bez prázdnych vĺn a nulových kariet.
- **Digitálny tieň podľa makety** (ADR-070): paleta a svetlo scény, izometrická kamera, KPI v riadku, detail kamióna, sledovanie balíka, plávajúce štítky.
- **Vnútro skladu** (ADR-071): triediaca linka ako graf v layoute skladu. Budimír má súčasný stav podľa náčrtu tímu a návrh Depot 5.0 (tunel, triediče so žľabmi, recirkulácia, dekódovanie). Kontrolné body sú zariadenia v db-telemetry, prechody balíkov sú v časovej osi balíka. V tieni pri odkrytej streche: prepínač variantov, porovnanie celého dňa, panel kontrolného bodu, trasa hľadaného balíka.

## Ako to predviesť (2 minúty)

1. Login: rozbaliť *Demo účty*, klik na `dispecer` vyplní meno, heslo z `.env`.
2. Dispečing (`/`) v situácii `night-cascade`: KPI, vlny, kaskáda, karta alarmu s akciami. Prepnúť sklad na *Žilina*: iný obsah, rovnaký layout.
3. Tieň Budimíra v `evening-peak`: klik na kamión pri LD-02 (detail ako v makete), potom *Odkryť strechu*.
4. Panel *Triediaca linka* → *Návrh Depot 5.0*: menej ručných manipulácií (len štítky, ktoré tunel neprečíta) a kratší čas na odkladaciu plochu. Klik na pin *Skenovací tunel*.
5. Hľadať balík, ktorý je na linke: modrá trasa, posledný kontrolný bod, v *Detail balíka* kontrolné body v časovej osi.

## Kde to je v kóde

| Čo | Kde |
| --- | --- |
| Design systém | `frontend/src/index.css` (tokeny), `frontend/src/components/ui/*`, `docs/design/komponenty.md` |
| Shell a sklad | `frontend/src/components/Sidebar.tsx`, `AppHeader.tsx`, `hooks/useDepot.ts`, `app/src/depotrack/services/depot_scope.py`, `api/shell.py`, `api/search.py` |
| Login | `frontend/src/pages/LoginPage.tsx`, `components/NetworkMap.tsx`, `app/src/depotrack/api/public.py` |
| Dispečing | `app/src/depotrack/services/dispatch.py`, `frontend/src/pages/DashboardPage.tsx` |
| Tieň | `frontend/src/shadow/*` (scéna, `parts.ts` s paletou, `hud/`, `panels/`) |
| Linka | `app/src/depotrack/seed/lines.py` (graf), `services/checkpoints.py`, `telematics/src/simulator/line.ts`, `telematics/src/api/line.ts`, `telematics/sql/008_checkpoints.sql`, `frontend/src/shadow/Line.tsx`, `hud/LinePanel.tsx`, `panels/CheckpointPanel.tsx` |

## Prečo je to tak navrhnuté

- **Makety pred kódom.** Prvý dizajn tieňa tím odmietol. Preto má každá obrazovka tabuľku „položka | maketa | pred | čo sa zmenilo | stav“ a do commitu ide, až keď je všetko ✓. Dáta majú prednosť pred ilustráciou v makete.
- **O prístupe k skladu rozhoduje server.** Prepínač je pohodlie, nie ochrana (ADR-017, ADR-068). Ctrl K, alarmy aj tieň filtrujú na serveri.
- **Linka je dátami.** Skutočné rozmery Budimíra sa zmenia v seede bez zmeny simulátora a tieňa. Návrh sa počíta nad tými istými balíkmi (what-if, ADR-047) a dáta skladu nemení. Každý balík má vlastný prúd náhody, preto sa golden test Budimíra nezmenil.
- **Tieň, nie dvojča.** Linka v tieni len zrkadlí prechody, nič neriadi (ADR-045).

## Možné otázky na obhajobe

- *Prečo má návrh rovnakú priepustnosť ako súčasný stav?* Linka dostáva rovnaké balíky v rovnakom čase, priepustnosť určuje prísun (kamióny, kuriéri). Návrh šetrí ručnú prácu a čas balíka na linke, nie počet balíkov.
- *Ako vznikne číslo „ručné manipulácie“?* Súčasný stav: každý balík pre prechody a Košice triedi človek v ploche „Prechody + KE“ a k tomu neprečítané linehaul balíky. Návrh: len balíky, ktorých štítok tunel neprečíta. Po 2 kolách idú na dekódovanie.
- *Je linka Budimíra skutočná?* Proces áno (náčrt tímu), rozmery a rýchlosti pásov sú odhad. Predpoklady sú v ADR-071.
- *Môže skladník vidieť iný sklad?* Nie, API vráti 403. Prepínať môže len dispečer a administrátor.
