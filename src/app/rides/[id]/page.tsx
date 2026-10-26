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
import { getBidirectionalBlockedUserIds, getBlockRelationship } from "@/lib/block";
import ReportUserModal from "@/components/ReportUserModal";
import BlockUserModal from "@/components/BlockUserModal";
import ShareTripModal from "@/components/ShareTripModal";
import PassengerTripPaymentCard from "@/components/PassengerTripPaymentCard";

export default async function RideDetails({ 
  params,
  searchParams 
}: { 
  params: { id: string },
  searchParams?: { origin?: string; destination?: string; fare?: string }
}) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; name?: string; email?: string } | undefined;

  const dbUser = user?.id ? await prisma.user.findUnique({
    where: { id: user.id },
    select: { gender: true, emergencyContactEmail: true, userType: true, phoneNumber: true }
  }) : null;

  const ride = await prisma.ride.findUnique({
    where: { id: params.id },
    include: {
      driver: { select: { id: true, name: true, email: true, phoneNumber: true, studentVerificationStatus: true, driverVerificationStatus: true } },
      bookings: {
        include: {
          user: { select: { id: true, name: true, phoneNumber: true } },
          payment: true,
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

  const blockedUserIds = user?.id ? await getBidirectionalBlockedUserIds(user.id) : [];
  const isBlockedWithDriver = user?.id ? blockedUserIds.includes(ride.driverId) : false;
  const hasBlockedCoPassenger = user?.id
    ? ride.bookings.some(
        (b) => (b.status === "PENDING" || b.status === "CONFIRMED") && blockedUserIds.includes(b.userId)
      )
    : false;

  const driverBlockRel = user?.id && user.id !== ride.driverId
    ? await getBlockRelationship(user.id, ride.driverId)
    : null;

  // Determine if the booking button should be disabled
  let disabledReason = "";
  if (!user) {
    disabledReason = "Sign in to book";
  } else if (ride.driverId === user.id) {
    disabledReason = "This is your ride";
  } else if (isBlockedWithDriver || hasBlockedCoPassenger) {
    disabledReason = "Booking unavailable (Block relationship)";
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

  const totalCapacity = ride.seats + (ride.bookings?.length || 0);
  const baselineDistance = (ride.baseDistance && ride.baseDistance > 0) ? ride.baseDistance : ride.distance;
  const computedFareFallback = baselineDistance 
    ? calculateFare({
        rideType: ride.rideType || "Private Pool",
        seats: totalCapacity,
        vehicleName: ride.vehicleName,
        routeDistanceMeters: baselineDistance,
      }).passengerTotal 
    : 0;

  const confirmedBookings = ride.bookings.filter((b) => b.status === "CONFIRMED");
  const totalConfirmedFares = confirmedBookings.reduce((sum, b) => sum + (b.fare || 0), 0);

  const displayFare = myBooking?.fare && myBooking.fare > 0
    ? myBooking.fare
    : (searchParams?.fare && parseFloat(searchParams.fare) > 0
        ? parseFloat(searchParams.fare)
        : (confirmedBookings.length > 0
            ? totalConfirmedFares
            : (computedFareFallback > 0 ? computedFareFallback : (ride.price > 0 ? ride.price : 0))));

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
                <div>
                  <span className="text-3xl font-bold text-primary">₹{displayFare.toFixed(2)}</span>
                  {typeof myBooking?.previousFare === "number" && myBooking.previousFare > 0 && Math.abs(myBooking.fare - myBooking.previousFare) > 0.01 && (
                    myBooking.fare < myBooking.previousFare ? (
                      <Badge className="ml-2 bg-emerald-600 hover:bg-emerald-600 text-white text-[11px] font-semibold">
                        Saved ₹{(myBooking.previousFare - myBooking.fare).toFixed(2)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2 text-amber-600 border-amber-300 text-[11px]">
                        Adjusted
                      </Badge>
                    )
                  )}
                </div>
                <p className="text-sm text-muted-foreground font-medium">
                  {myBooking
                    ? "Your Booking Fare"
                    : confirmedBookings.length > 0
                    ? `Total Ride Fare (${confirmedBookings.length} ${confirmedBookings.length === 1 ? "passenger" : "passengers"})`
                    : "Total Ride Fare"}
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
                <div className="flex flex-wrap items-center gap-3">
                  <SosButton rideId={ride.id} />
                  <ShareTripModal rideId={ride.id} rideStatus={ride.status} />
                </div>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 bg-muted/50 p-6 rounded-lg space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
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
                  {/* Authorized Driver Contact Number */}
                  {isDriver && (
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      <span className="font-mono">{ride.driver.phoneNumber ? `📞 ${ride.driver.phoneNumber}` : "No phone added to profile"}</span>
                      <span className="block text-[10px] text-muted-foreground">Shared only with confirmed passengers</span>
                    </div>
                  )}
                  {isPassenger && myBooking?.status === "CONFIRMED" && (
                    <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs">
                      <span className="font-semibold text-emerald-800 dark:text-emerald-300 block text-[11px]">
                        Driver Contact (Confirmed Trip):
                      </span>
                      <span className="font-mono font-medium text-xs text-foreground block mt-0.5">
                        {ride.driver.phoneNumber ? `📞 ${ride.driver.phoneNumber}` : "Driver has not added a phone number"}
                      </span>
                    </div>
                  )}
                  {isPassenger && myBooking?.status === "PENDING" && (
                    <p className="mt-1 text-[11px] text-muted-foreground italic">
                      Driver contact available once booking is confirmed.
                    </p>
                  )}
                </div>

                {user?.id && user.id !== ride.driverId && (
                  <div className="flex items-center gap-2 pt-2 border-t flex-wrap">
                    <ReportUserModal
                      targetUserId={ride.driver.id}
                      targetUserName={ride.driver.name}
                      rideId={ride.id}
                    />
                    <BlockUserModal
                      targetUserId={ride.driver.id}
                      targetUserName={ride.driver.name}
                      initialIsBlocked={driverBlockRel?.blockedByMe ?? false}
                    />
                  </div>
                )}

                {isDriver && ride.bookings.some((b) => b.status === "CONFIRMED" || b.status === "PENDING") && (
                  <div className="pt-3 border-t space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Passengers
                    </h4>
                    <div className="space-y-1.5">
                      {ride.bookings
                        .filter((b) => b.status === "CONFIRMED" || b.status === "PENDING")
                        .map((b) => {
                          const pPaid = b.payment?.amountPaid ?? (b.payment?.status === "SUCCEEDED" ? b.payment?.amount : 0);
                          const pBal = b.payment?.outstandingBalance ?? (b.payment?.status === "SUCCEEDED" ? 0 : b.fare);
                          const isFullyPaid = pBal === 0 && pPaid > 0;
                          const isPartiallyPaid = pPaid > 0 && pBal > 0;

                          return (
                            <div key={b.id} className="flex flex-col gap-1.5 text-xs bg-background p-2.5 rounded-lg border">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-foreground">{b.user.name}</span>
                                <div className="flex items-center gap-1">
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    {b.status}
                                  </Badge>
                                  {b.status === "CONFIRMED" && (
                                    <Badge 
                                      className={`text-[9px] px-1.5 py-0 ${
                                        isFullyPaid 
                                          ? "bg-emerald-600 hover:bg-emerald-600 text-white font-semibold" 
                                          : isPartiallyPaid 
                                          ? "bg-amber-600 hover:bg-amber-600 text-white font-semibold" 
                                          : ride.status === "COMPLETED" 
                                          ? "bg-rose-600 hover:bg-rose-600 text-white font-bold animate-pulse" 
                                          : "bg-muted text-muted-foreground"
                                      }`}
                                    >
                                      {isFullyPaid 
                                        ? "✓ Paid" 
                                        : isPartiallyPaid 
                                        ? `Partially Paid (Bal: ₹${pBal.toFixed(0)})` 
                                        : ride.status === "COMPLETED"
                                        ? "Payment Due"
                                        : "Due At Dest"}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                                <div>
                                  <span>Fare: <strong className="text-foreground">₹{b.fare.toFixed(2)}</strong></span>
                                  {Boolean(b.previousFare && b.previousFare > 0 && Math.abs(b.fare - b.previousFare) > 0.01 && b.fare < b.previousFare) && (
                                    <span className="ml-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                                      (Saved ₹{((b.previousFare || 0) - b.fare).toFixed(2)})
                                    </span>
                                  )}
                                </div>
                                {b.status === "CONFIRMED" && (
                                  <span>Paid: <strong className={pPaid > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>₹{pPaid.toFixed(2)}</strong></span>
                                )}
                              </div>
                              {b.status === "CONFIRMED" ? (
                                <div className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-2 py-1 rounded">
                                  {b.user.phoneNumber ? `📞 ${b.user.phoneNumber}` : "No phone provided"}
                                </div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground italic">
                                  Phone visible once confirmed
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 pt-1">
                                <ReportUserModal
                                  targetUserId={b.user.id}
                                  targetUserName={b.user.name}
                                  rideId={ride.id}
                                />
                                <BlockUserModal
                                  targetUserId={b.user.id}
                                  targetUserName={b.user.name}
                                  initialIsBlocked={blockedUserIds.includes(b.user.id)}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
              <div className="pt-2 border-t">
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
              {myBooking ? (
                <PassengerTripPaymentCard
                  rideId={ride.id}
                  rideStatus={ride.status}
                  bookingId={myBooking.id}
                  fare={myBooking.fare}
                  previousFare={myBooking.previousFare}
                  fareVersion={myBooking.fareVersion}
                  fareUpdatedAt={myBooking.fareUpdatedAt}
                  fareChangeReason={myBooking.fareChangeReason}
                  payment={myBooking.payment}
                  userName={user?.name || undefined}
                  userEmail={user?.email || undefined}
                  userPhone={dbUser?.phoneNumber || undefined}
                />
              ) : (
                <BookingButton 
                   rideId={ride.id} 
                   disabledReason={disabledReason} 
                   fare={displayFare} 
                   passengerOrigin={displayOrigin} 
                   passengerDestination={displayDestination} 
                   userGender={dbUser?.gender}
                   userPhone={dbUser?.phoneNumber}
                />
              )}
            </div>
            {canSeeChat && user?.id && (
              <div className="flex items-center gap-2">
                <ShareTripModal rideId={ride.id} rideStatus={ride.status} />
                <RideChatModal
                  rideId={ride.id}
                  currentUserId={user.id}
                  driverName={ride.driver.name}
                  driverId={ride.driver.id}
                  isDriver={isDriver}
                />
              </div>
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

