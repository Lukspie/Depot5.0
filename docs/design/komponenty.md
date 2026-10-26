# Design systém Depot 5.0

> Pre koho: kto robí frontend. Kód je vo [frontend/src/components/ui](../../frontend/src/components/ui), import cez `import { Badge, Card, … } from "../components/ui"`.

## Témy

Farby sú tokeny (CSS premenné) v [index.css](../../frontend/src/index.css) a prepínajú sa atribútom `<html data-theme="…">` (ADR-032). Prepínač je v hornej lište vpravo a voľba sa pamätá v prehliadači.

| Téma | Primárna | Navigácia | Pozadie | Kedy |
| --- | --- | --- | --- | --- |
| `oranzova` *(predvolená, „Oranžová“)* | oranžová `#f39200` | čierna `#1d1d1b` | teplá sivá `#f1f1ef` | firemný štýl prepravcu (oranžová, čierna, sivá) |
| `modra` | modrá `#2f5be9` | biela | modrosivá `#eef2f8` | podľa [reference.png](reference.png) |

**Nepoužívaj priame farby** (`bg-orange-500`, `#hex`), vždy tokeny:

| Token | Použitie |
| --- | --- |
| `canvas`, `surface`, `line` | pozadie stránky, karty, deliace čiary |
| `ink`, `ink-muted` | hlavný a vedľajší text |
| `brand-50/100/500/600/700`, `on-brand` | primárna farba, `text-on-brand` = text na primárnom tlačidle (v Oranžovej téme čierny kvôli kontrastu) |
| `chrome*` | bočná navigácia |
| `ok`, `info`, `warn`, `danger`, `neutral` (`-100` pozadie, `-600` text/bodka) | stavy, rovnaké v oboch témach |

Význam tónov: **ok** = v poriadku / prebieha (zelená), **info** = na ceste / informácia (modrá), **warn** = pozor, mešká, degradované (jantárová), **danger** = chyba, alarm, offline (červená), **neutral** = neaktívne / plánované (sivá), **brand** = zvýraznenie.

## Pravidlá

1. **Štítky a stavy sa nikdy nezalamujú.** `Badge` a `StatusDot` majú `whitespace-nowrap`, bodka a text stavu sú vždy na jednom riadku.
2. **Tabuľky majú pevné šírky stĺpcov** (`width` v rem). Jeden stĺpec (zvyčajne názov) je pružný. Text sa skracuje trojbodkou a celá hodnota je v tooltipe (`title`).
3. Na úzkych displejoch sa menej dôležité stĺpce skryjú (`hideBelow`). Tabuľka nikdy nie je užšia, než potrebujú stĺpce, a radšej sa posúva **vo vnútri karty**. **Stránka sama sa vodorovne nikdy neposúva.**
4. Každú obrazovku kontrolujeme pri šírkach **1280, 1440 a 390 px** (skript so screenshotmi v prehliadači overí aj pretečenie stránky).
5. Načítavanie: `Spinner`. Prázdne dáta: `EmptyState`. Chyba: červený pruh s možnosťou „Skúsiť znova“. Výpadok WebSocketu: „Offline“ v hornej lište, spojenie sa obnoví samo.
6. Texty v UI sú po slovensky, identifikátory v kóde po anglicky.

## Komponenty

### `Card`
Biela plávajúca karta s jemným tieňom a voliteľnou hlavičkou.
```tsx
<Card title="Naplnenosť jázd" subtitle="Odchody dnes" actions={<Button size="sm">Export</Button>}>…</Card>
<Card flush>{/* tabuľka/mapa od okraja po okraj */}</Card>
```

### `KpiCard`
KPI dlaždica ako v referencii: štvorec s ikonou, popis, veľké číslo, zmena a kontext.
```tsx
<KpiCard icon={<Package />} label="Balíky vo vlne" value="1 412" delta={{ value: "+15", tone: "ok" }} context="večerná vlna · 25. 10." />
```

### `Badge`
Stavový štítok (pilulka). `tone`, `size` (`sm|md|lg`), `dot`.
```tsx
<Badge tone="ok">Nakladá sa</Badge>  <Badge tone="danger" dot>Zlý smer</Badge>
```

### `StatusDot`
Bodka a text na jednom riadku, voliteľne pulzuje (živé zariadenie).
```tsx
<StatusDot tone="ok" colored>Aktívny</StatusDot>  <StatusDot tone="danger" pulse>offline</StatusDot>
```

### `DataTable`
Tabuľka s pevnými šírkami, ellipsis, skrývaním stĺpcov a stavmi načítavania a prázdnych dát.
```tsx
const columns: Column<Trip>[] = [
  { key: "dir", header: "Smer", minWidth: "10rem", render: (t) => t.directionName, title: (t) => t.directionName },
  { key: "status", header: "Stav", width: "9rem", render: (t) => <Badge tone="ok">…</Badge> },
  { key: "door", header: "Brána", width: "6rem", hideBelow: "md", render: (t) => t.doorCode },
  { key: "open", header: "", width: "3rem", control: true, render: () => <ChevronRight /> },
];
<DataTable columns={columns} rows={trips} rowKey={(t) => t.id} onRowClick={open} loading={q.isPending} />
```
`control: true` znamená bunku s ovládacím prvkom (tlačidlom), ktorá sa neskracuje trojbodkou.

### `SidePanel` + `KeyValue`
Detail objektu: na desktope plávajúci panel vpravo, na mobile spodný panel. Zatvára sa klávesom Escape.
```tsx
<SidePanel open onClose={close} eyebrow="Kamión · linehaul" title="KE-102LH" subtitle="Bratislava · brána LD-02" icon={<Truck />}>
  <KeyValue rows={[["Stav", <Badge tone="ok">Nakladá sa</Badge>], ["Odchod", "21:30"]]} />
</SidePanel>
```

### `PageHeader`, `Tabs`, `Progress`, `Button`, `EmptyState`, `Spinner`, `Logo`
- `PageHeader`: nadpis stránky, podnadpis a akcie vpravo.
- `Tabs`: „pilulky“ v sivom kontajneri, aktívna je biela, voliteľný počet (`count="4/6"`).
- `Progress`: tenký pruh s popisom „3/6“ (`label`).
- `Button`: varianty `primary | secondary | ghost | danger`, veľkosti `sm | md | lg`, `icon`.
- `EmptyState`, `Spinner`: stavy bez dát a načítavania.
- `Logo`: značka vo farbe aktuálnej témy.

Ikony: [lucide-react](https://lucide.dev), veľkosť 16–20 px.
