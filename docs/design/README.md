# Vizuálny cieľ

Hlavná referencia: [reference.png](reference.png) (izometrický dashboard skladu). Ďalšie zábery:

| Súbor | Čo z neho brať |
| --- | --- |
| [reference.png](reference.png) | celkový layout: KPI karty hore, 3D scéna, pravý panel s detailom, tabuľka s tabmi vpravo dole, časová os zásielky dole |
| [reference-2-paleta-detail.png](reference-2-paleta-detail.png) | detail objektu: hlavička s ikonou, stavový štítok, riadky „kľúč – hodnota“ |
| [reference-3-kamion-panel.png](reference-3-kamion-panel.png) | detail kamióna: progress bar nakládky, odkazy, zoznam vozíkov so stavmi a percentami |
| [reference-4-zoznam-kamionov.png](reference-4-zoznam-kamionov.png) | zoznam kamiónov: farebná bodka, štítok stavu, mini progress, šípka na detail |

> Referencia slúži **len ako štýlová inšpirácia**. Logo, názov ani obsah nepreberáme, Depot 5.0 má vlastnú identitu.

## Čo z referencie preberáme (platí pre celú aplikáciu, nielen pre digitálny tieň)

- **Plocha:** svetlé, mierne modrosivé pozadie a scéna v pastelových modrých tónoch.
- **Karty a panely:** biele, s veľkým zaoblením (~16 px), jemným rozptýleným tieňom a bez ostrých okrajov. Plávajú nad scénou.
- **Primárna farba:** sýta modrá (kamión, budova, aktívny tab, odkazy). Akcenty sú obmedzené: zelená (OK, prebieha), oranžová (pozor, nabíjanie, nízky stav), modrá (na ceste, info).
- **KPI karta:** štvorcová ikona s jemným modrým pozadím vľavo, nad hodnotou malý popis, veľké tučné číslo, vedľa zelená zmena so šípkou, pod tým drobný sivý kontext.
- **Stavové štítky:** pastelové pozadie, tmavší text tej istej farby, nikdy sa nezalamujú. Bodka a text sú vždy na jednom riadku.
- **Tabuľky v paneloch:** kód vozidla tučne a pod ním menší sivý kontext, štítok stavu, mini progress bar s „3/6“ a šípka „›“.
- **Taby:** „pilulky“ v sivom kontajneri, aktívny tab je biely s počtom (napr. „Docks 4/6“).
- **Detailový panel vpravo:** hlavička (ikona, nadpis, podnadpis, akcie), stavový štítok s kontextom, progress a riadky „kľúč vľavo / hodnota vpravo“ oddelené jemnou čiarou.
- **Časová os:** kruhové kroky spojené čiarou, hotové kroky sú vyplnené modrou, aktuálny krok má prstenec, pod krokom je čas.
- **Typografia:** bezpätkové písmo, nadpisy semibold, čísla tabulárne.

Konkrétne farebné tokeny a komponenty budú zdokumentované vo Fáze 3 v `docs/design/komponenty.md`.
