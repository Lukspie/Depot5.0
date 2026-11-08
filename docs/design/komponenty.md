# Design systém Depot 5.0 (v2)

> Pre koho: kto robí frontend. Kód je vo [frontend/src/components/ui](../../frontend/src/components/ui), import cez `import { Card, KpiCard, … } from "../components/ui"`. Vizuálny cieľ: schválená [maketa dispečingu](maketa-dispecing/README.md) (design systém v2, Fáza 7d, ADR-067), pre digitálny tieň [maketa-tien](maketa-tien/README.md).

## Štýl a témy

Štýl moderných SaaS dashboardov (shadcn/ui, Linear, Vercel): plná šírka, karty s tenkým okrajom, husté tabuľky, čierne primárne tlačidlo, **oranžová len na zvýraznenie** (aktívna položka, progress, značky).

Farby sú tokeny (CSS premenné) v [index.css](../../frontend/src/index.css), prepínajú sa atribútom `<html data-theme="…">` (ADR-032). Téma sa vyberá v menu účtu (klik na meno dole v bočnej lište) a pamätá sa v prehliadači.

| Téma | Zvýraznenie | Navigácia | Pozadie |
| --- | --- | --- | --- |
| `oranzova` *(predvolená, „Oranžová“)* | oranžová `#f39200` | čierna `#1d1d1b` | `#f4f4f2` |
| `modra` | modrá `#2f5be9` | biela | `#f2f4f8` |

**Nepoužívaj priame farby** (`bg-orange-500`, `#hex`), vždy tokeny:

| Token | Použitie |
| --- | --- |
| `canvas`, `surface`, `subtle` | pozadie stránky, karty, hlavička tabuľky a polia |
| `line`, `line-soft`, `track` | okraj karty, deliace čiary vo vnútri karty, podklad segmentov a pruhov |
| `ink`, `ink-soft`, `ink-muted`, `ink-faint` | text: hlavný, v tabuľke, vedľajší, popisky osí |
| `primary`, `on-primary` | primárne tlačidlo (čierne) |
| `brand-50 … 800`, `on-brand` | zvýraznenie, oranžový text `brand-700` |
| `chrome*` | bočná navigácia |
| `ok`, `info`, `warn`, `danger`, `neutral`: `-100` pozadie, `-600` bodka a pruh, `-700` text | stavy, kontrast textu ≥ 4,5 : 1 |

Význam tónov: **ok** = v poriadku / prebieha, **info** = na ceste / informácia, **warn** = pozor, mešká, degradované, **danger** = chyba, alarm, offline, **neutral** = plánované / neaktívne, **brand** = zvýraznenie.

**Rozmery:** karta radius 12 px, okraj 1 px, tieň len `0 1px 2px`. Riadok tabuľky 52 px, hlavička 34 px. Odstupy mriežky 12–16 px, padding stránky 24 px. Horná lišta 60 px, bočná lišta 232 px (v tieni 72 px).

**Typografia:** Inter, čísla tabulárne. Nadpis stránky 24/800, nadpis karty 15/700, telo 13 px, popisky 11–12 px, hlavičky tabuliek 11 px kapitálky.

## Pravidlá

1. **Čísla a časy cez [lib/format.ts](../../frontend/src/lib/format.ts):** `num` (`1 989`), `pct` (`88,9 %`), `kg`, `hhmm` (`06:06`), `relative` (`o 3 h 20 min`, `pred 5 min`), `signedMinutes` (`+4 min`, `−1 min`). Nikdy `toFixed` ani anglický formát. Čas je simulovaný čas z telematiky.
2. **Štítky a stavy sa nikdy nezalamujú** (`whitespace-nowrap`).
3. **Tabuľky majú pevné šírky stĺpcov** (`width` v rem), jeden stĺpec je pružný. Text sa skracuje trojbodkou, celá hodnota je v tooltipe.
4. Na úzkych displejoch sa menej dôležité stĺpce skryjú (`hideBelow`) a tabuľka sa posúva **vo vnútri karty**. **Stránka sa vodorovne nikdy neposúva.**
5. Každú obrazovku kontrolujeme pri **1280, 1440 a 390 px**. Obrazovku s maketou porovnávame so screenshotom vedľa makety ([docs/fazy/faza-7d-ui.md](../fazy/faza-7d-ui.md)).
6. Načítavanie: `Spinner`, prázdne dáta: `EmptyState`, výpadok WebSocketu: sivá pilulka „offline“ v hornej lište.
7. Ovládacie prvky s vyskakovacím obsahom (menu, popover, tooltip, dialóg, select) sú na **Radix** primitívach: klávesnica, focus a ARIA sú vyriešené (ADR-067). Grafy sú vlastné SVG.
8. Texty v UI sú po slovensky, identifikátory v kóde po anglicky.

## Shell

- **Bočná lišta** (`components/Sidebar.tsx`): logo, zvolený sklad s typom z dát (`Budimír · prekládkové depo`), sekcie **Prevádzka** a **Systém**, odznak počtu vo fronte pri Bráne, zelená bodka pri Stave systému, dole účet s menu (téma, odhlásenie). Položky podľa role (o prístupe rozhoduje backend, ADR-017). V tieni zbalená na 72 px s tooltipmi.
- **Horná lišta** `AppHeader`: sklad, drobčeky, hľadanie (Ctrl K), aktuálna vlna, simulovaný čas s rýchlosťou (zelená beží, jantárová pauza, sivá offline), alarmy s počtom a zoznamom. Dáta z `GET /api/shell`.
- Na telefóne je navigácia riadok s posúvaním pod logom.

## Komponenty

| Komponent | Čo to je | Príklad |
| --- | --- | --- |
| `Card` | biela karta s okrajom, voliteľná hlavička (`title`, `subtitle`, `actions`), `flush` pre tabuľky | `<Card title="Jazdy dňa" actions={<FilterChips …/>} flush>` |
| `PageHeader` | nadpis stránky 24/800, kontext, akcie vpravo | `<PageHeader title="Dispečing" subtitle="…" actions={<Button>Export dňa</Button>} />` |
| `KpiCard` | značka + popis, číslo s jednotkou, `spark`, `delta`, `context`; s `icon` kompaktná verzia nad scénou tieňa | `<KpiCard label="Naložené" value="476" unit="/ 1 989" spark={[…]} delta={{ value: "24 %", tone: "neutral" }} context="59 nenaložených" />` |
| `Sparkline` | malý čiarový graf s plochou (SVG) | `<Sparkline values={[…]} tone="warn" />` |
| `DataTable` | 34 px hlavička, 52 px riadky (`compact` 40 px), `groups` so záhlavím skupiny, `actions` na riadku, `hideBelow` | `<DataTable columns={…} groups={[{ key, title, sub, dot, rows }]} actions={(r) => <Menu …/>} />` |
| `StatusBadge` | stav: bodka + text, 22 px, jemný okraj; `variant="plain"` pre plánované | `<StatusBadge tone="ok">Nakladá sa</StatusBadge>` |
| `DeltaBadge` | malá zmena pri čísle | `<DeltaBadge tone="danger">+21 min</DeltaBadge>` |
| `RiskChip` | riziko v bunke tabuľky s ikonou | `<RiskChip tone="danger">Kaskáda</RiskChip>` |
| `Badge` | tónovaný štítok (typ alarmu, počet) | `<Badge tone="danger" size="sm">7</Badge>` |
| `AlertItem` | alarm: farebný pruh, typ, čas, nadpis jednou vetou, fakty ako čipy, primárna a sekundárna akcia | `<AlertItem tone="danger" type="Kaskáda meškania" meta="23:51 · ML predikcia" title="…" facts={[…]} primary={{ label: "Otvoriť scenár", onClick }} secondary={{ label: "Potvrdiť", onClick }} />` |
| `SegmentedTabs` (`Tabs`) | segmentový prepínač s počtom | `<SegmentedTabs items={[{ id: "dep", label: "Odchody", count: 8 }]} active={tab} onChange={setTab} />` |
| `FilterChips` | pilulkové filtre, aktívny čierny, `accent` pre „S rizikom“ | `<FilterChips items={…} active={f} onChange={setF} />` |
| `StackedBar` | skladaný pruh (naložené / odstavené / čaká), `scale` voči najdlhšiemu | `<StackedBar segments={[…]} scale={0.6} />` |
| `DayTimeline` | prevádzkový deň 15:00 → 15:00 s úsekmi a značkou „teraz“ | `<DayTimeline dayStart={…} segments={[…]} now={now} />` |
| `Button` | `primary` čierne, `brand` oranžové (akcia v tieni), `secondary`, `ghost`, `danger`; `sm` 28 px, `md` 34 px | `<Button icon={<Download size={15} />}>Export dňa</Button>` |
| `Menu`, `MenuItem`, `MenuLabel`, `MenuSeparator` | rozbaľovacie menu (Radix) | menu účtu, akcie riadku |
| `Popover`, `Tooltip` | vyskakovacie okno a popis pri hoveri (Radix) | zoznam alarmov v hornej lište, zbalená navigácia |
| `Dialog` | modálne okno (Radix) | potvrdenie akcie |
| `Select` | výber z možností (Radix) | sklad na `/gate` |
| `Progress`, `StatusDot`, `EmptyState`, `Spinner`, `SidePanel` + `KeyValue`, `Logo` | ako doteraz, v tokenoch v2 | |
