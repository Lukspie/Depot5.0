# Maketa dispečingu a design systém v2 (schválené tímom)

Vizuálny cieľ pre obrazovku Dispečing (`/`) a **základ design systému v2 pre celú aplikáciu**. Štýl vychádza z moderných SaaS dashboardov (shadcn/ui, Linear, Vercel) v téme Oranžová.

| Súbor | Čo to je |
| --- | --- |
| [dispecing-maketa.png](dispecing-maketa.png) | Budimír, 02:25, nočná vlna (1440 px, 2×) |
| [dispecing-maketa.html](dispecing-maketa.html) | statická verzia, dá sa otvoriť v prehliadači a vyčítať presné hodnoty |
| [dispecing-maketa.dc.html](dispecing-maketa.dc.html) | zdroj makety |

## Prečo redizajn (čo bolo zle)
- obsah bol úzky stĺpec v strede, po stranách prázdne pásy → **plná šírka**, hustá mriežka,
- KPI karty mali každá inú pastelovú ikonu a čísla bez kontextu → **jednotné karty**, farebná je len malá značka a zmena, k tomu **sparkline**,
- riedka tabuľka, sivé štítky, náhodné farby progressu → **husté riadky (52 px), zoskupenie, relatívny čas, riziko ako stĺpec, akcie na riadku**,
- alarmy boli odseky textu → **štruktúra: typ, čas, jednovetý nadpis, fakty ako čipy, akcie**,
- slabá hlavička → **horná lišta** so skladom, vyhľadávaním (Ctrl K), vlnou, živým časom a alarmami, pod ňou nadpis s akciami.

## Design systém v2 (platí pre všetky obrazovky)
**Knižnica:** komponenty v štýle **shadcn/ui** (Radix primitíva + Tailwind 4), skopírované do `frontend/src/components/ui` a napojené na naše tokeny. Grafy cez shadcn charts / Recharts alebo jednoduché SVG sparklines.

| Token | Hodnota |
| --- | --- |
| pozadie stránky | `#f4f4f2` |
| karta | biela, **okraj 1 px `#e7e6e2`**, radius **12 px**, tieň len `0 1px 2px rgb(29 29 27 / .04)` |
| text / sekundárny | `#1d1d1b` / `#6b6b68` (min. kontrast 4,5 : 1) |
| primárna | `#f39200` (len zvýraznenie: aktívna položka, progress, značky). Oranžový text `#a85f00` |
| primárne tlačidlo | **čierne** `#1d1d1b` s bielym textom. Sekundárne: biele s okrajom |
| stavy (pozadie / text) | ok `#e8f6ee / #17603a` · info `#eaf0ff / #2347c2` · warn `#fdf3d8 / #8a5800` · danger `#fdecec / #a32727` · neutral `#f1f1ee / #5c5c58` |
| typografia | Inter, čísla tabulárne. Nadpis stránky 24/800, nadpis karty 15/700, telo 13, popisky 11–12. Hlavičky tabuliek 11 px, kapitálky, letter-spacing .05em |
| hustota | riadok tabuľky 52 px, hlavička tabuľky 34 px, odstupy mriežky 12–16 px, padding stránky 24 px |
| čísla | slovenský formát: `88,9 %`, `1 989`, čas `06:06`, relatívny čas `o 3 h 20 min` |

**Komponenty:** `KpiCard` (značka, popis, číslo + jednotka, sparkline, zmena + kontext), `DataTable` so skupinami riadkov a stĺpcom akcií, `StatusBadge` (bodka + text, jemný okraj), `DeltaBadge` (+4 min), `RiskChip`, `AlertItem` (farebný pruh vľavo, typ, čas, nadpis, čipy faktov, primárna a sekundárna akcia), `SegmentedTabs`, `FilterChips`, `StackedBar`, `DayTimeline` (prevádzkový deň 15:00 → 15:00 so značkou „teraz“), horná lišta `AppHeader`.

## Dispečing – obsah
1. **KPI:** balíky dňa, naložené, kamióny pri bránach, čítanosť skenerov, alarmy.
2. **Jazdy dňa:** taby Odchody / Príchody, filtre (Všetky, Diaľkové, Prechody, S rizikom). Skupiny „Večerné diaľkové odchody“ a „Ranné prechody“, pri odídených počet nenaložených balíkov, pri plánovaných „nakládka od“, odhad z ML s odchýlkou, riziko (kaskáda, skener).
3. **Alarmy:** filtre podľa závažnosti, štruktúrované položky s akciami (Otvoriť scenár, Detail balíka, Poslať na údržbu, Potvrdiť).
4. **Balíky podľa smerov:** skladané pruhy naložené / odstavené / čaká.
5. **Prevádzkový deň:** časová os vĺn a odchodov so značkou „teraz“.
