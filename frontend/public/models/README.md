# Voliteľné 3D modely pre digitálny tieň

Scéna `/shadow` predvolene kreslí jednoduché tvary (`src/shadow/parts.ts`). Ak chceš krajší kamión:

1. Stiahni CC0 model (napr. [Kenney.nl](https://kenney.nl/assets) – „Car Kit“) vo formáte `.glb`.
2. Ulož ho sem, napr. `public/models/truck.glb`.
3. V `src/shadow/models.ts` nastav `truck: "/models/truck.glb"`.

Model má smerovať na sever (−z) a počiatok má byť na zadnej strane návesu (pri bráne).
Kým sa model načítava alebo ak chýba, scéna ukáže jednoduchý tvar.
