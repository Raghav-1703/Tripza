import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import SearchForm from "@/components/SearchForm";
import ManageBooking from "@/components/ManageBooking";
import CancelBooking from "@/components/CancelBooking";
import DeleteRide from "@/components/DeleteRide";
import RideStatusControl from "@/components/RideStatusControl";
import PassengerWindowSync from "@/components/PassengerWindowSync";
import DriverRequestSync from "@/components/DriverRequestSync";

export default async function Dashboard() {
  const session = await getServerSession(authOptions);
  const user = session?.user;

  if (!user?.id) {
    redirect("/login");
  }

  const userType = user.userType || "PASSENGER";
  const isDriverRole = userType === "DRIVER" || userType === "BOTH";
  const isPassengerRole = userType === "PASSENGER" || userType === "BOTH";

  const now = new Date();

  const myRides = isDriverRole ? await prisma.ride.findMany({
    where: { driverId: user.id },
    orderBy: { departure: 'asc' },
    include: {
      bookings: {
        include: { 
          user: { 
            select: { 
              name: true, 
              gender: true,
              studentVerificationStatus: true,
            } 
          },
          payment: true,
        }
      }
    }
  }) : [];

  const activeDriverRide = isDriverRole ? myRides.find(r => r.status === "ACTIVE") : null;

  const myBookings = isPassengerRole ? await prisma.booking.findMany({
    where: { userId: user.id },
    include: {
      payment: true,
      ride: {
        include: { 
          driver: { 
            select: { 
              name: true, 
              studentVerificationStatus: true,
              driverVerificationStatus: true 
            } 
          } 
        }
      }
    },
    orderBy: { ride: { departure: 'asc' } }
  }) : [];

  const upcomingBookings = myBookings.filter(b => 
    (new Date(b.ride.departure) >= now || b.ride.status === "ACTIVE") && 
    b.ride.status !== "COMPLETED" && 
    b.ride.status !== "CANCELLED" && 
    b.status !== "CANCELLED" && 
    b.status !== "REJECTED"
  );
  
  const pastOrCancelledBookings = myBookings.filter(b => 
    (new Date(b.ride.departure) < now && b.ride.status !== "ACTIVE") || 
    b.ride.status === "COMPLETED" || 
    b.ride.status === "CANCELLED" || 
    b.status === "CANCELLED" || 
    b.status === "REJECTED"
  );

  const upcomingPublishedRides = myRides.filter(r => (new Date(r.departure) >= now || r.status === "ACTIVE") && r.status !== "COMPLETED" && r.status !== "CANCELLED");
  const pastPublishedRides = myRides.filter(r => new Date(r.departure) < now || r.status === "COMPLETED" || r.status === "CANCELLED");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      <DriverRequestSync />
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 border-b pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isDriverRole && !isPassengerRole ? "Driver Dashboard" : isPassengerRole && !isDriverRole ? "Passenger Dashboard" : "Dashboard"}
          </h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, <span className="font-semibold text-foreground">{user?.name}</span> ({userType === "DRIVER" ? "Driver Account" : userType === "PASSENGER" ? "Passenger / Student Account" : "Driver & Passenger Account"}).
          </p>
        </div>
        {isDriverRole && (
          activeDriverRide ? (
            <div className="text-right">
              <span className={cn(buttonVariants({ variant: "outline" }), "opacity-60 cursor-not-allowed pointer-events-none")}>
                + Publish a Ride
              </span>
              <p className="text-[11px] text-destructive mt-1 font-medium">Complete current ride first</p>
            </div>
          ) : (
            <Link href="/rides/create" className={cn(buttonVariants({ variant: "default" }))}>
              + Publish a Ride
            </Link>
          )
        )}
      </div>
      
      {isPassengerRole && (
        <div className="bg-card border text-card-foreground shadow-sm rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <span>🔍 Find a Ride</span>
          </h2>
          <SearchForm />
        </div>
      )}

      {/* PASSENGER SECTION */}
      {isPassengerRole && (
      <section className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <span>Upcoming &amp; Active Bookings</span>
            <Badge variant="secondary" className="text-xs">{upcomingBookings.length}</Badge>
          </h3>

          {upcomingBookings.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                You have no upcoming or active ride bookings. Use the search form above to find and book a seat!
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {upcomingBookings.map((booking) => (
                <Card key={booking.id} className="flex flex-col border shadow-sm hover:shadow-md transition-shadow">
                  <PassengerWindowSync rideId={booking.ride.id} currentStatus={booking.ride.status} />
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <CardTitle className="text-base hover:text-primary transition-colors">
                          <Link href={`/rides/${booking.ride.id}`}>
                            {booking.pickupLocation || booking.ride.origin} → {booking.dropLocation || booking.ride.destination}
                          </Link>
                        </CardTitle>
                        {(booking.pickupLocation && booking.pickupLocation !== booking.ride.origin) || (booking.dropLocation && booking.dropLocation !== booking.ride.destination) ? (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Driver route: {booking.ride.origin} → {booking.ride.destination}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant={booking.status === "CONFIRMED" ? "default" : booking.status === "PENDING" ? "outline" : "secondary"}>
                        {booking.status}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">
                      🕒 {new Date(booking.ride.departure).toLocaleString(undefined, { 
                        weekday: 'short', month: 'short', day: 'numeric', 
                        hour: 'numeric', minute: '2-digit' 
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-between space-y-4">
                    <div className="text-sm space-y-2 bg-muted/30 p-3 rounded-lg border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Driver:</span>
                        <span className="font-semibold text-foreground flex items-center gap-1">
                          {booking.ride.driver.name}
                          {booking.ride.driver.driverVerificationStatus === "APPROVED" && (
                            <span title="Verified Driver" className="text-blue-600 text-xs">✓</span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Fare:</span>
                        <div className="text-right">
                          <span className="font-semibold text-primary">
                            {booking.fare > 0 ? `₹${booking.fare.toFixed(2)}` : "₹0.00"}
                          </span>
                          {booking.previousFare && booking.previousFare > 0 && Math.abs(booking.fare - booking.previousFare) > 0.01 ? (
                            booking.fare < booking.previousFare ? (
                              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                Reduced from ₹{booking.previousFare.toFixed(2)} (Saved ₹{(booking.previousFare - booking.fare).toFixed(2)})
                              </p>
                            ) : (
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                Adjusted from ₹{booking.previousFare.toFixed(2)}
                              </p>
                            )
                          ) : null}
                          {booking.fareChangeReason ? (
                            <p className="text-[9px] text-muted-foreground italic max-w-[200px] truncate" title={booking.fareChangeReason}>
                              {booking.fareChangeReason}
                            </p>
                          ) : null}
                          {booking.detourFare && booking.detourFare > 0 ? (
                            <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                              Incl. ₹{booking.detourFare.toFixed(2)} detour ({((booking.detourDistance || 0) / 1000).toFixed(2)} km)
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {(() => {
                        const pPaid = booking.payment?.amountPaid ?? (booking.payment?.status === "SUCCEEDED" ? booking.payment?.amount : 0);
                        const pBal = booking.payment?.outstandingBalance ?? (booking.payment?.status === "SUCCEEDED" ? 0 : booking.fare);
                        const isFullyPaid = pBal === 0 && pPaid > 0;
                        const isPartiallyPaid = pPaid > 0 && pBal > 0;
                        const isOverpaid = pPaid > booking.fare;
                        const refundCredit = isOverpaid ? Math.round((pPaid - booking.fare) * 100) / 100 : (booking.payment?.refundAmount ?? 0);

                        return (
                          <div className="flex items-center justify-between pt-1 border-t">
                            <span className="text-xs font-medium text-muted-foreground">Payment Status:</span>
                            <div className="flex flex-col items-end gap-1">
                              <Badge 
                                className={`text-[10px] font-semibold ${
                                  isFullyPaid 
                                    ? "bg-emerald-600 text-white hover:bg-emerald-600" 
                                    : isPartiallyPaid 
                                    ? "bg-amber-600 text-white hover:bg-amber-600"
                                    : booking.payment?.status === "PROCESSING"
                                    ? "bg-sky-600 text-white"
                                    : booking.payment?.status === "FAILED"
                                    ? "bg-rose-600 text-white"
                                    : booking.ride.status === "COMPLETED"
                                    ? "bg-rose-600 text-white animate-pulse"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {isFullyPaid 
                                  ? `✓ PAID (₹${pPaid.toFixed(2)})` 
                                  : isPartiallyPaid 
                                  ? `PARTIAL (Paid ₹${pPaid.toFixed(0)} / Due ₹${pBal.toFixed(0)})` 
                                  : booking.ride.status === "COMPLETED"
                                  ? `DUE: ₹${pBal.toFixed(2)}`
                                  : `DUE AT DEST (₹${pBal.toFixed(2)})`}
                              </Badge>
                              {refundCredit > 0 && (
                                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  Refund Credit: ₹${refundCredit.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="flex items-center justify-between pt-1 border-t">
                        <span className="text-xs font-medium text-muted-foreground">Seat Sharing Preference:</span>
                        <Badge variant="outline" className="text-[10px] bg-background">
                          {booking.preferredPassengerGender === "FEMALE" ? "♀ Prefer Female" : "○ No Preference"}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <Link 
                        href={`/rides/${booking.ride.id}`}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1 text-xs")}
                      >
                        View Ride →
                      </Link>
                      <CancelBooking bookingId={booking.id} status={booking.status} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {pastOrCancelledBookings.length > 0 && (
          <div className="pt-4">
            <h3 className="text-base font-semibold mb-3 text-muted-foreground flex items-center gap-2">
              <span>Past &amp; Cancelled Bookings</span>
              <Badge variant="outline" className="text-xs">{pastOrCancelledBookings.length}</Badge>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pastOrCancelledBookings.map((booking) => (
                <Card key={booking.id} className="opacity-75 flex flex-col border text-sm">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-center gap-2">
                      <CardTitle className="text-sm">
                        <Link href={`/rides/${booking.ride.id}`} className="hover:underline">
                          {booking.pickupLocation || booking.ride.origin} → {booking.dropLocation || booking.ride.destination}
                        </Link>
                      </CardTitle>
                      <Badge variant="secondary" className="text-[10px]">
                        {booking.status}
                      </Badge>
                    </div>
                    <CardDescription className="text-[11px]">
                      {new Date(booking.ride.departure).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-1 flex flex-col gap-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Driver: {booking.ride.driver.name}</span>
                      <span className="font-semibold text-foreground">₹{booking.fare.toFixed(2)}</span>
                    </div>
                    {(() => {
                      const pPaid = booking.payment?.amountPaid ?? (booking.payment?.status === "SUCCEEDED" ? booking.payment?.amount : 0);
                      const pBal = booking.payment?.outstandingBalance ?? (booking.payment?.status === "SUCCEEDED" ? 0 : booking.fare);
                      const isDue = pBal > 0 && booking.status === "CONFIRMED";

                      if (booking.ride.status === "COMPLETED" && isDue) {
                        return (
                          <div className="flex items-center justify-between pt-1 border-t">
                            <Badge className="bg-rose-600 text-white font-bold text-[10px] animate-pulse">
                              Payment Due: ₹{pBal.toFixed(2)}
                            </Badge>
                            <Link href={`/rides/${booking.ride.id}`} className="text-rose-600 font-bold hover:underline text-[11px]">
                              Pay Final Fare →
                            </Link>
                          </div>
                        );
                      }

                      if (booking.ride.status === "COMPLETED") {
                        return (
                          <div className="flex items-center justify-between pt-1 border-t">
                            <Badge className="bg-emerald-600 text-white text-[10px]">
                              {pPaid > 0 ? `✓ Paid (₹${pPaid.toFixed(2)})` : "✓ Paid in Full"}
                            </Badge>
                            <Link href={`/rides/${booking.ride.id}`} className="text-amber-600 dark:text-amber-400 font-semibold hover:underline text-[11px]">
                              ★ Rate Driver →
                            </Link>
                          </div>
                        );
                      }

                      return null;
                    })()}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </section>
      )}

      {/* DRIVER SECTION */}
      {isDriverRole && (
      <section className="space-y-6 pt-4">
        <DriverRequestSync />
        {activeDriverRide && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 p-4 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm">
            <div>
              <h3 className="font-bold flex items-center gap-2 text-base">
                <span>🚗 Active Ride in Progress</span>
                <Badge className="bg-amber-600 hover:bg-amber-700 text-white text-[10px]">ACTIVE</Badge>
              </h3>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                {activeDriverRide.origin} → {activeDriverRide.destination}. Complete or cancel your current ride before publishing another.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <RideStatusControl rideId={activeDriverRide.id} status={activeDriverRide.status} />
              <Link href={`/rides/${activeDriverRide.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-xs")}>
                View Ride →
              </Link>
            </div>
          </div>
        )}

        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <span>Upcoming &amp; Active Published Rides</span>
            <Badge variant="secondary" className="text-xs">{upcomingPublishedRides.length}</Badge>
          </h3>

          {upcomingPublishedRides.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                You haven&apos;t published any upcoming rides yet. Click &quot;+ Publish a Ride&quot; to share your route!
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {upcomingPublishedRides.map((ride) => (
                <Card key={ride.id} className="flex flex-col border shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-base hover:text-primary transition-colors">
                        <Link href={`/rides/${ride.id}`}>
                          {ride.origin} → {ride.destination}
                        </Link>
                      </CardTitle>
                      <Badge variant={ride.status === "ACTIVE" ? "default" : "outline"} className={ride.status === "ACTIVE" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}>
                        {ride.status}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">
                      🕒 {new Date(ride.departure).toLocaleString(undefined, { 
                        weekday: 'short', month: 'short', day: 'numeric', 
                        hour: 'numeric', minute: '2-digit' 
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-between space-y-4">
                    {(() => {
                      const confirmedFares = ride.bookings
                        .filter(b => b.status === "CONFIRMED")
                        .reduce((sum, b) => sum + (b.fare ?? 0), 0);
                      return (
                        <div className="flex justify-between text-xs bg-muted/40 p-2.5 rounded-lg border">
                          <span><span className="font-semibold text-foreground text-sm">{ride.seats}</span> seats available</span>
                          <span className="text-right">
                            <span className="block text-[10px] text-muted-foreground">Confirmed Earnings</span>
                            <span className="font-semibold text-emerald-600 text-sm">₹{confirmedFares.toFixed(2)}</span>
                          </span>
                        </div>
                      );
                    })()}
                    
                    <div className="bg-muted/50 p-3 rounded-md space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Passenger Bookings ({ride.bookings.length})
                      </p>
                      {ride.bookings.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No passenger requests yet.</p>
                      ) : (
                        <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {ride.bookings.map((booking) => (
                            <li key={booking.id} className="text-xs p-2 rounded bg-background border space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-foreground">{booking.user.name}</span>
                                <div className="flex items-center gap-1.5">
                                  {(() => {
                                    const pPaid = booking.payment?.amountPaid ?? (booking.payment?.status === "SUCCEEDED" ? booking.payment?.amount : 0);
                                    const pBal = booking.payment?.outstandingBalance ?? (booking.payment?.status === "SUCCEEDED" ? 0 : booking.fare);
                                    const isPaid = pBal === 0 && pPaid > 0;
                                    const isPartial = pPaid > 0 && pBal > 0;
                                    
                                    if (booking.status !== "CONFIRMED") return null;

                                    return (
                                      <Badge 
                                        className={`text-[9px] px-1.5 py-0 ${
                                          isPaid 
                                            ? "bg-emerald-600 text-white" 
                                            : isPartial 
                                            ? "bg-amber-600 text-white" 
                                            : ride.status === "COMPLETED"
                                            ? "bg-rose-600 text-white"
                                            : "bg-muted text-muted-foreground"
                                        }`}
                                      >
                                        {isPaid ? "✓ Paid" : isPartial ? `Paid ₹${pPaid.toFixed(0)}` : `Due ₹${pBal.toFixed(0)}`}
                                      </Badge>
                                    );
                                  })()}
                                  <Badge 
                                    variant={booking.status === "CONFIRMED" ? "default" : booking.status === "PENDING" ? "outline" : "secondary"} 
                                    className="text-[9px] px-1.5 py-0"
                                  >
                                    {booking.status}
                                  </Badge>
                                </div>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <div>
                                  <span>Fare: <strong className="text-foreground">₹{booking.fare.toFixed(2)}</strong></span>
                                  {booking.previousFare && booking.previousFare > 0 && Math.abs(booking.fare - booking.previousFare) > 0.01 && booking.fare < booking.previousFare ? (
                                    <span className="ml-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                                      (Saved ₹{(booking.previousFare - booking.fare).toFixed(2)})
                                    </span>
                                  ) : null}
                                </div>
                                <ManageBooking bookingId={booking.id} status={booking.status} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 pt-2 border-t flex-wrap">
                      <RideStatusControl rideId={ride.id} status={ride.status} />
                      <Link 
                        href={`/rides/${ride.id}`}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1 text-xs text-center")}
                      >
                        Manage Ride →
                      </Link>
                      <DeleteRide rideId={ride.id} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {pastPublishedRides.length > 0 && (
          <div className="pt-4">
            <h3 className="text-base font-semibold mb-3 text-muted-foreground flex items-center gap-2">
              <span>Past Published Rides</span>
              <Badge variant="outline" className="text-xs">{pastPublishedRides.length}</Badge>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pastPublishedRides.map((ride) => (
                <Card key={ride.id} className="opacity-75 flex flex-col border text-sm">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm">
                      <Link href={`/rides/${ride.id}`} className="hover:underline">
                        {ride.origin} → {ride.destination}
                      </Link>
                    </CardTitle>
                    <CardDescription className="text-[11px]">
                      {new Date(ride.departure).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-1 flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">{ride.bookings.filter(b => b.status === "CONFIRMED").length} passenger(s)</span>
                    {ride.status === "COMPLETED" ? (
                      <Link href={`/rides/${ride.id}`} className="text-amber-600 dark:text-amber-400 font-semibold hover:underline text-[11px]">
                        ★ Rate Passengers →
                      </Link>
                    ) : (
                      <Link href={`/rides/${ride.id}`} className="text-primary hover:underline text-[11px]">
                        View Details →
                      </Link>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </section>
      )}
    </div>
  );
}
