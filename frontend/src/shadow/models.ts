/**
 * Optional GLTF models instead of the primitives (zadanie §7). Put a CC0 model (e.g. from
 * Kenney.nl) into frontend/public/models/ and set its URL here, e.g. truck: "/models/truck.glb".
 * The model must face north (-z) with its origin at the rear of the trailer (the door).
 * Empty by default: the scene works with the primitives from parts.ts.
 */
export const MODEL_URLS: Partial<Record<"truck", string>> = {};
