# Analýza bundlu frontendu

> Pre koho: kto mení závislosti frontendu alebo rieši rýchlosť načítania. Rozhodnutie je v ADR-046.

**Cieľ:** prihlasovacia stránka, dispečing a ostatné 2D obrazovky nesmú sťahovať three.js, React Three Fiber, drei ani MapLibre. Tie sa načítajú až pri otvorení Flotily (`/fleet`) alebo digitálneho tieňa (`/shadow`).

## Ako to zmerať

```bash
cd frontend
npm run analyze          # vite build --mode analyze
# výsledok: dist/stats.html (interaktívna mapa modulov, rollup-plugin-visualizer)
```

![Treemap bundlu](bundle-treemap.png)

## Výsledok (Fáza 5, 26. 10. 2026)

| Chunk | Kedy sa načíta | Obsah | Veľkosť | gzip |
| --- | --- | --- | --- | --- |
| `index` | vždy | React, React Router, TanStack Query, 2D obrazovky | 297 kB | 91 kB |
| `labels` | vždy (zdieľané) | UI kit, popisy stavov, lucide ikony | 80 kB | 27 kB |
| `parts` | Flotila alebo tieň | **three.js** a spoločné 3D diely (`src/shadow/parts.ts`) | 742 kB | 189 kB |
| `ShadowPage` | `/shadow` | **React Three Fiber, drei, zustand**, scéna a panely | 239 kB | 77 kB |
| `MapView` | Flotila, sledovanie, kuriér | **MapLibre GL** | 1 078 kB | 293 kB |
| `GltfModel` | len ak je nastavený GLTF model | drei `Gltf` + GLTFLoader | 77 kB | 23 kB |

- V hlavnom chunku (`index`) nie je three.js, R3F, drei ani MapLibre. Overené aj vyhľadaním `WebGLRenderer`, `useFrame` a `maplibre` v zostavených súboroch.
- three.js je v jednom zdieľanom chunku. Flotila (3D hala na mape) aj tieň ho používajú spoločne a prehliadač ho stiahne len raz.
- GLTF loader sa načíta, až keď je v `src/shadow/models.ts` nastavený model. Predvolená scéna používa jednoduché tvary.
- Limit varovania `chunkSizeWarningLimit` je 1 800 kB kvôli MapLibre (lazy chunk).
