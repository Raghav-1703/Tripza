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
  seats?: number;
  vehicleName?: string;
  routeDistanceMeters: number;
  pickupDetourMeters?: number;
  dropDetourMeters?: number;
  baseRatePerKm?: number;
  detourRatePerKm?: number;
  includePlatformFee?: boolean;
}

export function isBikeVehicle(seats?: number, vehicleName?: string): boolean {
  if (seats === 1) return true;
  if (vehicleName) {
    const vn = vehicleName.trim().toLowerCase();
    if (
      vn.includes("bike") ||
      vn.includes("splend") ||
      vn.includes("activa") ||
      vn.includes("scoot") ||
      vn.includes("motorcycle") ||
      vn.includes("pulsar")
    ) {
      return true;
    }
  }
  return false;
}

export function getVehicleRates(seats?: number, vehicleName?: string) {
  const isBike = isBikeVehicle(seats, vehicleName);
  return {
    baseRatePerKm: isBike ? 5 : 8,
    detourRatePerKm: isBike ? 8 : 10,
    vehicleLabel: isBike ? "Bike" : "Car",
  };
}

/**
 * Authoritative Server-Side Fare Calculation Engine
 * 
 * Rates:
 * - Bike (1 seat): ₹5/km base rate, ₹8/km detour rate
 * - 4-Seater & 6-Seater Car: ₹8/km base rate, ₹10/km detour rate
 * - Platform fee: 3%
 * - Monetary values stored and rounded in integer paise for precision.
 */
export function calculateFare({
  rideType = "Private Pool",
  seats,
  vehicleName,
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

  const rates = getVehicleRates(seats, vehicleName);
  const baseRate = baseRatePerKm ?? rates.baseRatePerKm;
  const detourRate = detourRatePerKm ?? rates.detourRatePerKm;
  const poolingIncentive = 0;
  const feeRate = includePlatformFee === false ? 0 : 0.03;

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
