export interface FareDetails {
  mainRouteFare: number;
  pickupDetourFare: number;
  dropDetourFare: number;
  detourFare: number;
  poolingIncentive: number;
  subtotal: number;
  platformFee: number;
  passengerTotal: number;
  passengerTotalPaise: number;
  driverEarning: number;
  baseRatePerKm: number;
  detourRatePerKm: number;
  routeDistanceKm: number;
  pickupDetourKm: number;
  dropDetourKm: number;
  totalDetourKm: number;
}

export interface FareCalculationInput {
  rideType?: string;
  routeDistanceMeters: number;
  pickupDetourMeters?: number;
  dropDetourMeters?: number;
  baseRatePerKm?: number;
  detourRatePerKm?: number;
  includePlatformFee?: boolean;
}

/**
 * Authoritative Server-Side Fare Calculation Engine
 * 
 * Rules for Private Pooling:
 * - Base travel fare: ₹10 per km
 * - Additional detour fare: ₹10 per detour km
 * - Normal travel distance and detour distance are calculated separately (never double-counted).
 * - Monetary values stored and rounded in integer paise for precision.
 */
export function calculateFare({
  rideType = "Private Car Pool",
  routeDistanceMeters,
  pickupDetourMeters = 0,
  dropDetourMeters = 0,
  baseRatePerKm,
  detourRatePerKm,
  includePlatformFee,
}: FareCalculationInput): FareDetails {
  const mainDistanceKm = routeDistanceMeters / 1000;
  const pickupDetourKm = pickupDetourMeters / 1000;
  const dropDetourKm = dropDetourMeters / 1000;
  const totalDetourKm = pickupDetourKm + dropDetourKm;

  let baseRate = baseRatePerKm ?? 10;
  let detourRate = detourRatePerKm ?? 10;
  let poolingIncentive = 0;
  let feeRate = includePlatformFee === false ? 0 : 0.03;

  if (rideType === "Personal Cab") {
    baseRate = baseRatePerKm ?? 20;
    detourRate = detourRatePerKm ?? 20;
    poolingIncentive = 0;
    feeRate = includePlatformFee === false ? 0 : 0.03;
  } else if (rideType === "Private Car Pool" || rideType === "Private Pooling") {
    baseRate = baseRatePerKm ?? 10;
    detourRate = detourRatePerKm ?? 10;
    poolingIncentive = 0;
    feeRate = includePlatformFee === false ? 0 : 0.03;
  } else if (rideType === "Cab Pool") {
    baseRate = baseRatePerKm ?? 20;
    detourRate = detourRatePerKm ?? 20;
    poolingIncentive = 3;
    feeRate = includePlatformFee === false ? 0 : 0.03;
  }

  const mainRouteFare = Math.round(mainDistanceKm * baseRate * 100) / 100;
  const pickupDetourFare = Math.round(pickupDetourKm * detourRate * 100) / 100;
  const dropDetourFare = Math.round(dropDetourKm * detourRate * 100) / 100;
  const detourFare = Math.round((pickupDetourFare + dropDetourFare) * 100) / 100;

  const subtotal = Math.round((mainRouteFare + detourFare + poolingIncentive) * 100) / 100;
  const platformFee = Math.round(subtotal * feeRate * 100) / 100;
  const passengerTotal = Math.round((subtotal + platformFee) * 100) / 100;
  const passengerTotalPaise = Math.round(passengerTotal * 100);
  const driverEarning = subtotal;

  return {
    mainRouteFare,
    pickupDetourFare,
    dropDetourFare,
    detourFare,
    poolingIncentive,
    subtotal,
    platformFee,
    passengerTotal,
    passengerTotalPaise,
    driverEarning,
    baseRatePerKm: baseRate,
    detourRatePerKm: detourRate,
    routeDistanceKm: mainDistanceKm,
    pickupDetourKm,
    dropDetourKm,
    totalDetourKm,
  };
}
