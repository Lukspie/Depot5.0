# Maketa digitálneho tieňa (schválená tímom)

Vizuálny cieľ pre `/shadow` (Fáza 5b). Platí pred [reference.png](../reference.png): referencia bola inšpirácia, **táto maketa je schválený cieľ** pre Depot 5.0 v téme Oranžová.

| Súbor | Čo to je |
| --- | --- |
| [tien-maketa.png](tien-maketa.png) | Budimír, 18:42, večerná vlna, vybraný kamión KE-102LH (1440 × 900, 2×) |
| [tien-maketa-strecha-odkryta.png](tien-maketa-strecha-odkryta.png) | to isté s odkrytou strechou (pás, odbočky, odstavné plochy, líniový skener) |
| [tien-maketa.html](tien-maketa.html) | statická verzia, dá sa otvoriť v prehliadači a vyčítať presné farby a rozmery |
| [tien-maketa.dc.html](tien-maketa.dc.html) | zdroj makety (scéna je izometrická SVG ilustrácia, generovaná v `renderVals()`) |

Scéna v makete je **ilustrácia, nie implementácia**. V R3F treba trafiť jej vzhľad (farby, uhol, hustotu detailov, rozmiestnenie panelov), nie kopírovať SVG.

## Layout
- Bočná navigácia je na tejto obrazovke **zbalená na pruh s ikonami (72 px)**, scéna ide cez celú zvyšnú plochu.
- Horná lišta: prepínač skladu (Budimír depo / Ivanka pri Dunaji hub) · „5/8 brán obsadených“ · vyhľadávanie (`/`) · zelená pilulka s časom simulácie, vlnou a rýchlosťou · Scenár (čo ak) · alarmy s počtom.
- Pod lištou **4 nízke KPI karty v jednom riadku** (pod 1380 px v dvoch).
- Vpravo detail objektu (360 px) a úzky stĺpec kamery (+, −, otočiť, domov, odkryť strechu).
- Vpravo dole taby Brány / Kamióny / Zariadenia s legendou stavov. Vľavo dole sledovanie balíka s časovou osou.

## Art direction scény
- **Kamera:** izometria zo strany dvora, fasáda s bránami ide diagonálne stredom obrazu. **Strecha je predvolene zatvorená**, odkrytie je prepínač.
- **Kontrast:** prostredie je svetlé a takmer bez farby, farbu majú objekty.

| Prvok | Farba |
| --- | --- |
| zem / tráva / asfalt dvora / rampa | `#f3f2ee` / `#e2ead6` / `#e4e3de` / `#ecebe7` |
| fasáda (svetlá strana) / bočná stena | `#f8f7f4` s rebrami `#e6e4df` / `#d9d7d1` s rebrami `#cdcbc5` |
| sokel / strecha / svetlíky | `#d8d6d0` / `#ebe9e4` / `#dde2e5` |
| atika (pás pod strechou), rámy brán | `#f39200` (bočná strana `#d47f00`) |
| zatvorená brána / otvorená brána | `#d4d2cc` s lamelami `#c4c2bc` / `#3a3936` s krabicami v otvore |
| čísla brán, tabuľa „Depot 5.0 · BUDIMÍR“ | tmavé tabuľky `#1d1d1b`, biely text |
| vodorovné značenie státí / jazdný pruh | `#eebd45` / biele prerušované čiary |
| náves / ťahač diaľkový / ťahač prechod | biely `#fdfdfc` / tmavý `#2f2e2c` / oranžový `#f39200` |
| dodávky kuriérov | biele s oranžovým pruhom |
| krabice | `#dcb17e` / `#c99a66` / `#b5864f` |
| sklo | `#a9bccb` |

- **Tri odtiene na každý objekt:** vrch najsvetlejší, fasáda stredná, bočná strana najtmavšia. V 3D: hemisphere + directional svetlo zľava zhora, mäkké `ContactShadows` pod vozidlami a pod halou.
- **Piny:** tvar kvapky (zelená online, jantárová `#c97f00` degradované, červená offline, fialová údržba), biely obrys a tieň pod hrotom. Degradovaný pin má jemný prstenec.
- **Plávajúce štítky** v scéne len pre to, čo je dôležité práve teraz: vybraný kamión (oranžový obrys), degradované zariadenie, prichádzajúci a čakajúci kamión. Ostatné popisky sa ukážu pri hoveri.
- **Vybraný objekt:** oranžový obrys vrchu a štítok nad ním, riadok v tabe zvýraznený `#fff6eb`.
- **Showcase čas** pre screenshoty a review: večerná vlna okolo 18:30 (situácia „Večerná vlna – špička“ z Fázy 5d).
