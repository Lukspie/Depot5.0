# 3D modely digitálneho tieňa

Scéna `/shadow` používa CC0 modely od Kenney (licencia a presný zdroj v [LICENSE.txt](LICENSE.txt), ADR-052):

| Model | Kde v scéne |
| --- | --- |
| `car-kit/delivery.glb` | dodávky kuriérov pri ich odstavných plochách počas nakládky |
| `car-kit/sedan.glb`, `car-kit/suv.glb` | neočakávané autá na dvore (prejazdy vjazdovou bránou) |
| `factory-kit/box-small.glb` | balíky na páse (inštancie geometrie, max. 300 naraz) |
| `factory-kit/box-large.glb` | kopy balíkov na odstavných plochách a v otvore brán (inštancie) |

Kamión (ťahač s návesom) je vlastný diel v `src/shadow/parts.ts`, Car Kit ho nemá.
Hala, pás a brány sú tiež vlastné diely, lebo vznikajú z rozloženia `/api/layout`.

Pravidlá:
- každý kit má vlastný priečinok s `Textures/colormap.png` (GLB naň odkazujú rovnakým menom),
- `*.glb` je v `.gitattributes` ako binárny súbor, spolu najviac ~2 MB,
- nový model zapíš do `src/shadow/models.ts` aj sem, licenciu do `LICENSE.txt`.
