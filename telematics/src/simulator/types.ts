/** Shapes shared by the simulator, the app client and the API. */

export type TripKind = "inbound" | "outbound";
export type TripStatus =
  | "planned"
  | "en_route"
  | "at_door"
  | "loading"
  | "departed"
  | "completed"
  | "cancelled";
export type DirectionType = "linehaul" | "transit" | "local";

/** A trip as planned by the app (GET /internal/plan). Times are ISO strings. */
export interface PlanTrip {
  id: number;
  operatingDay: string;
  kind: TripKind;
  status: TripStatus;
  vehiclePlate: string;
  vehicleKind: "truck" | "van";
  directionCode: string;
  directionName: string;
  directionType: DirectionType;
  dependsOnLinehaul: string[];
  doorCode: string | null;
  plannedArrival: string | null;
  plannedDeparture: string | null;
}

export interface Plan {
  day: string;
  cascadeBufferMin: number;
  trips: PlanTrip[];
}

/** Execution state reported back to the app (POST /internal/events/trips). */
export interface TripExecution {
  tripId: number;
  status: TripStatus;
  actualArrival: string | null;
  actualDeparture: string | null;
  predictedArrival: string | null;
}

export interface Position {
  lat: number;
  lon: number;
  speedKmh: number;
  heading: number;
  moving: boolean;
}
