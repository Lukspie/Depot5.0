/**
 * CC0 models from Kenney (frontend/public/models, LICENSE.txt, ADR-052). One unit of the kits is not
 * one metre: `scale` brings them to real size (a sedan is ~4.4 m). The truck stays a custom part
 * (parts.ts), the Car Kit has no tractor with a semi-trailer.
 */
export const MODELS = {
  van: { url: "/models/car-kit/delivery.glb", scale: 1.7 },
  cars: [
    { url: "/models/car-kit/sedan.glb", scale: 1.7 },
    { url: "/models/car-kit/suv.glb", scale: 1.7 },
  ],
  /** parcels on the belt (instanced geometry) */
  parcel: { url: "/models/factory-kit/box-small.glb", scale: 1.3 },
  /** boxes of the piles on staging bays and in open doors (instanced geometry) */
  pileBox: { url: "/models/factory-kit/box-large.glb", scale: 1.2 },
} as const;
