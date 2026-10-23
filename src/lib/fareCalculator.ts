export interface FareDetails {
  mainRouteFare: number;
  pickupDetourFare: number;
  dropDetourFare: number;
  poolingIncentive: number;
  subtotal: number;
  platformFee: number;
  passengerTotal: number;
  driverEarning: number;
}

export function calculateFare({
  rideType,
  routeDistanceMeters,
  pickupDetourMeters = 0,
  dropDetourMeters = 0,
}: {
  rideType: string;
  routeDistanceMeters: number;
  pickupDetourMeters?: number;
  dropDetourMeters?: number;
}): FareDetails {
  const mainDistanceKm = routeDistanceMeters / 1000;
  const pickupDetourKm = pickupDetourMeters / 1000;
  const dropDetourKm = dropDetourMeters / 1000;

  let mainRouteFare = 0;
  let pickupDetourFare = 0;
  let dropDetourFare = 0;
  let poolingIncentive = 0;
  let subtotal = 0;
  let platformFee = 0;
  let passengerTotal = 0;
  let driverEarning = 0;

  if (rideType === "Personal Cab") {
    mainRouteFare = mainDistanceKm * 20;
    pickupDetourFare = pickupDetourKm * 20;
    dropDetourFare = dropDetourKm * 20;
    subtotal = mainRouteFare + pickupDetourFare + dropDetourFare;
    platformFee = subtotal * 0.03;
    passengerTotal = subtotal + platformFee;
    driverEarning = subtotal;
  } else if (rideType === "Private Car Pool") {
    mainRouteFare = mainDistanceKm * 10;
    pickupDetourFare = pickupDetourKm * 20;
    dropDetourFare = dropDetourKm * 20;
    // For Private Car Pool, pooling incentive is 0 in the subtotal example provided:
    // Subtotal = 30 + 20 + 20 = 70.
    subtotal = mainRouteFare + pickupDetourFare + dropDetourFare + poolingIncentive;
    platformFee = subtotal * 0.03;
    passengerTotal = subtotal + platformFee;
    driverEarning = subtotal;
  } else if (rideType === "Cab Pool") {
    mainRouteFare = mainDistanceKm * 20;
    pickupDetourFare = pickupDetourKm * 20;
    dropDetourFare = dropDetourKm * 20;
    poolingIncentive = 3;
    subtotal = mainRouteFare + pickupDetourFare + dropDetourFare + poolingIncentive;
    platformFee = subtotal * 0.03;
    passengerTotal = subtotal + platformFee;
    driverEarning = subtotal; // For cab pool, driver earning is sum of subtotals, so per passenger it's the subtotal.
  }

  return {
    mainRouteFare,
    pickupDetourFare,
    dropDetourFare,
    poolingIncentive,
    subtotal,
    platformFee,
    passengerTotal,
    driverEarning,
  };
}
