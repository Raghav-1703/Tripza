import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import BookingButton from "@/components/BookingButton";
import ActiveRideLocationMap from "@/components/ActiveRideLocationMap";
import RideChatModal from "@/components/RideChatModal";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { calculateFare } from "@/lib/fareCalculator";
import SosButton from "@/components/SosButton";
import RideStatusControl from "@/components/RideStatusControl";
import PassengerWindowSync from "@/components/PassengerWindowSync";
import RatingForm from "@/components/RatingForm";
import DriverPassengerRatings from "@/components/DriverPassengerRatings";
import BackButton from "@/components/BackButton";

export default async function RideDetails({ 
  params,
  searchParams 
}: { 
  params: { id: string },
  searchParams?: { origin?: string; destination?: string; fare?: string }
}) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string } | undefined;

  const dbUser = user?.id ? await prisma.user.findUnique({
    where: { id: user.id },
    select: { gender: true, emergencyContactEmail: true, userType: true }
  }) : null;

  const ride = await prisma.ride.findUnique({
    where: { id: params.id },
    include: {
      driver: { select: { id: true, name: true, email: true, studentVerificationStatus: true, driverVerificationStatus: true } },
      bookings: {
        include: {
          user: { select: { id: true, name: true } }
        }
      },
    }
  });

  if (!ride) {
    notFound();
  }

  const existingRatings = await prisma.rating.findMany({
    where: { rideId: ride.id },
  });

  const hasFemaleCoPassengerPref = ride.bookings.some(
    (b) => (b.status === "PENDING" || b.status === "CONFIRMED") && b.preferredPassengerGender === "FEMALE"
  );

  // Determine if the booking button should be disabled
  let disabledReason = "";
  if (!user) {
    disabledReason = "Sign in to book";
  } else if (ride.driverId === user.id) {
    disabledReason = "This is your ride";
  } else if (ride.status === "COMPLETED") {
    disabledReason = "Ride has ended";
  } else if (ride.status === "CANCELLED") {
    disabledReason = "Ride was cancelled";
  } else if (ride.seats < 1) {
    disabledReason = "Ride is full";
  } else if (ride.bookings.some((b) => b.userId === user.id)) {
    disabledReason = "You've booked this ride";
  }

  const isDriver = user?.id === ride.driverId;
  const isPassenger = user?.id ? ride.bookings.some(b => b.userId === user?.id && (b.status === "PENDING" || b.status === "CONFIRMED")) : false;
  const canSeeChat = isDriver || isPassenger;

  const myBooking = user?.id
    ? ride.bookings.find(
        (b) => b.userId === user.id && (b.status === "PENDING" || b.status === "CONFIRMED")
      )
    : null;

  const computedFareFallback = ride.distance 
    ? calculateFare({ rideType: ride.rideType || "Personal Cab", routeDistanceMeters: ride.distance }).passengerTotal 
    : 0;

  const displayFare = myBooking?.fare && myBooking.fare > 0
    ? myBooking.fare
    : (searchParams?.fare && parseFloat(searchParams.fare) > 0
        ? parseFloat(searchParams.fare)
        : (ride.price > 0 ? ride.price : computedFareFallback));

  const displayOrigin = myBooking?.pickupLocation || searchParams?.origin || ride.origin;
  const displayDestination = myBooking?.dropLocation || searchParams?.destination || ride.destination;

  let parsedRouteGeometry: [number, number][] | undefined = undefined;
  if (ride.routeGeometry) {
    try {
      parsedRouteGeometry = JSON.parse(ride.routeGeometry);
    } catch {}
  }

  const confirmedStops = ride.bookings
    .filter((b) => b.status === "CONFIRMED")
    .flatMap((b) => {
      const s = [];
      if (
        typeof b.pickupLat === "number" &&
        typeof b.pickupLon === "number" &&
        !isNaN(b.pickupLat) &&
        !isNaN(b.pickupLon)
      ) {
        s.push({
          id: `${b.id}-pickup`,
          type: "PICKUP" as const,
          bookingId: b.id,
          passengerName: b.user.name,
          locationName: b.pickupLocation || "Pickup",
          lat: b.pickupLat,
          lon: b.pickupLon,
        });
      }
      if (
        typeof b.dropLat === "number" &&
        typeof b.dropLon === "number" &&
        !isNaN(b.dropLat) &&
        !isNaN(b.dropLon)
      ) {
        s.push({
          id: `${b.id}-drop`,
          type: "DROP" as const,
          bookingId: b.id,
          passengerName: b.user.name,
          locationName: b.dropLocation || "Drop-off",
          lat: b.dropLat,
          lon: b.dropLon,
        });
      }
      return s;
    });

  const passengerRatingForDriver = isPassenger && ride.status === "COMPLETED" 
    ? existingRatings.find(r => r.reviewerId === user?.id && r.revieweeId === ride.driver.id)
    : null;

  const confirmedPassengersForDriver = isDriver && ride.status === "COMPLETED"
    ? ride.bookings
        .filter(b => b.status === "CONFIRMED")
        .map(b => {
          const existing = existingRatings.find(r => r.reviewerId === user?.id && r.revieweeId === b.user.id);
          return {
            id: b.user.id,
            name: b.user.name,
            existingRating: existing ? { rating: existing.rating, review: existing.review } : null,
          };
        })
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 space-y-8">
      {(isPassenger || isDriver) && (
        <PassengerWindowSync rideId={ride.id} currentStatus={ride.status} />
      )}
      <BackButton fallbackHref="/dashboard" label="Back" />
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
            <div>
              <div className="flex items-center gap-3">
                <CardTitle className="text-2xl">{displayOrigin} → {displayDestination}</CardTitle>
                <Badge 
                  variant={ride.status === "ACTIVE" ? "default" : ride.status === "COMPLETED" ? "secondary" : "outline"} 
                  className={ride.status === "ACTIVE" ? "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold" : ""}
                >
                  {ride.status}
                </Badge>
              </div>
              <CardDescription className="text-lg mt-2 text-foreground">
                {new Date(ride.departure).toLocaleString(undefined, { 
                  weekday: 'long', month: 'long', day: 'numeric', 
                  hour: 'numeric', minute: '2-digit' 
                })}
              </CardDescription>
            </div>
            <div className="text-right flex flex-col items-end gap-2">
              <div>
                <span className="text-3xl font-bold text-primary">₹{displayFare.toFixed(2)}</span>
                <p className="text-sm text-muted-foreground font-medium">
                  {myBooking ? "Your Booking Fare" : "Total Ride Fare"}
                </p>
                {myBooking && myBooking.detourFare && myBooking.detourFare > 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                    Includes ₹{myBooking.detourFare.toFixed(2)} detour fee ({((myBooking.detourDistance || 0) / 1000).toFixed(2)} km)
                  </p>
                ) : null}
              </div>
              {isDriver && (
                <div className="pt-1">
                  <RideStatusControl rideId={ride.id} status={ride.status} />
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          {hasFemaleCoPassengerPref && (
            <div className="bg-pink-50 dark:bg-pink-950/40 border border-pink-200 dark:border-pink-900 text-pink-700 dark:text-pink-300 px-4 py-3 rounded-lg flex items-center gap-2 text-sm font-medium">
              <span>🛡️ Safety:</span>
              <span>Female co-passenger preference active for this ride</span>
            </div>
          )}

          {isPassenger && ride.status === "ACTIVE" && (
            <div className="bg-card border-2 border-emerald-500/50 p-6 rounded-xl space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
                <div>
                  <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <span>🚗 Ride in Progress</span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Driver: <span className="font-semibold text-foreground">{ride.driver.name}</span>
                  </p>
                </div>
                <div className="text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  {dbUser?.emergencyContactEmail ? "🛡️ Emergency contact configured" : "⚠️ Emergency contact not configured"}
                </div>
              </div>

              <div className="pt-2">
                <p className="text-xs text-muted-foreground mb-3">
                  If you encounter an emergency during this trip, press the SOS button below to alert your emergency contact immediately.
                </p>
                <SosButton rideId={ride.id} />
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 bg-muted/50 p-6 rounded-lg space-y-4 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Driver</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <p className="text-lg font-medium">{ride.driver.name}</p>
                  {ride.driver.driverVerificationStatus === "APPROVED" && (
                    <Badge variant="default" className="bg-blue-600 hover:bg-blue-700 text-[10px]">
                      ✓ Verified Driver
                    </Badge>
                  )}
                  {ride.driver.studentVerificationStatus === "APPROVED" && (
                    <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-[10px]">
                      ✓ Verified Student
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Available Seats</h3>
                <p className="text-lg font-medium">{ride.seats}</p>
              </div>
            </div>

            <div className="md:col-span-2">
              <ActiveRideLocationMap 
                rideId={ride.id}
                origin={
                  typeof ride.originLat === "number" && typeof ride.originLon === "number" && !isNaN(ride.originLat) && !isNaN(ride.originLon)
                    ? { name: ride.origin, lat: ride.originLat, lon: ride.originLon }
                    : ride.origin
                } 
                destination={
                  typeof ride.destLat === "number" && typeof ride.destLon === "number" && !isNaN(ride.destLat) && !isNaN(ride.destLon)
                    ? { name: ride.destination, lat: ride.destLat, lon: ride.destLon }
                    : ride.destination
                } 
                passengerOrigin={searchParams?.origin}
                passengerDestination={searchParams?.destination}
                isActive={ride.status === "ACTIVE"}
                canShareLiveLocation={isDriver && ride.status === "ACTIVE"}
                routeGeometry={parsedRouteGeometry}
                stops={confirmedStops}
              />
            </div>
          </div>

          <div className="pt-4 border-t flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="flex-1">
              <BookingButton 
                 rideId={ride.id} 
                 disabledReason={disabledReason} 
                 fare={displayFare} 
                 passengerOrigin={displayOrigin} 
                 passengerDestination={displayDestination} 
                 userGender={dbUser?.gender}
              />
            </div>
            {canSeeChat && user?.id && (
              <RideChatModal
                rideId={ride.id}
                currentUserId={user.id}
                driverName={ride.driver.name}
                driverId={ride.driver.id}
                isDriver={isDriver}
              />
            )}
          </div>

          {isPassenger && ride.status === "COMPLETED" && (
            <div className="pt-6 border-t space-y-4">
              <h3 className="text-lg font-bold">Rate your Driver ({ride.driver.name})</h3>
              <RatingForm 
                rideId={ride.id} 
                revieweeId={ride.driver.id}
                revieweeName={ride.driver.name}
                existingRating={passengerRatingForDriver ? { rating: passengerRatingForDriver.rating, review: passengerRatingForDriver.review } : null} 
              />
            </div>
          )}

          {isDriver && ride.status === "COMPLETED" && (
            <div className="pt-6 border-t space-y-4">
              <h3 className="text-lg font-bold">Rate Passengers</h3>
              <DriverPassengerRatings 
                rideId={ride.id} 
                passengers={confirmedPassengersForDriver} 
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

