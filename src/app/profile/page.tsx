import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import ProfileSafetyForm from "@/components/ProfileSafetyForm";
import ProfileAccountForm from "@/components/ProfileAccountForm";
import BlockedUsersList from "@/components/BlockedUsersList";
import ContactManagement from "@/components/ContactManagement";

export default async function Profile() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      ratingsReceived: {
        include: {
          reviewer: { select: { name: true } },
          ride: { select: { id: true, driverId: true, origin: true, destination: true } }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!user) {
    redirect("/login");
  }

  const isPassengerRole = user.userType === "PASSENGER" || user.userType === "BOTH";
  const isDriverRole = user.userType === "DRIVER" || user.userType === "BOTH";
  const isStrictDriverOnly = user.userType === "DRIVER";
  const isStrictPassengerOnly = user.userType === "PASSENGER";
  const hasEmergencyContact = !!(user.emergencyContactName || user.emergencyContactPhone || user.emergencyContactEmail);

  const ratingsReceived = user.ratingsReceived || [];

  // Ratings received by this user when acting as DRIVER (reviews from Passengers)
  const driverRatingsReceived = ratingsReceived.filter(r => r.ride.driverId === user.id);
  const driverRatingCount = driverRatingsReceived.length;
  const driverAverageRating = driverRatingCount > 0
    ? (driverRatingsReceived.reduce((sum, r) => sum + r.rating, 0) / driverRatingCount).toFixed(1)
    : null;

  // Ratings received by this user when acting as PASSENGER (reviews from Drivers)
  const passengerRatingsReceived = ratingsReceived.filter(r => r.ride.driverId !== user.id);
  const passengerRatingCount = passengerRatingsReceived.length;
  const passengerAverageRating = passengerRatingCount > 0
    ? (passengerRatingsReceived.reduce((sum, r) => sum + r.rating, 0) / passengerRatingCount).toFixed(1)
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 border-b pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Profile</h1>
          <p className="text-muted-foreground mt-1">
            Manage your account details, role capabilities, and verification status.
          </p>
        </div>
        <Link
          href="/profile/verification"
          className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors shadow-xs"
        >
          Verification Portal →
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
          <CardDescription>Your basic profile information on Tpool.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className="font-semibold text-sm text-muted-foreground block">Full Name</span>
              <span className="text-lg font-medium">{user.name}</span>
            </div>
            <div>
              <span className="font-semibold text-sm text-muted-foreground block">Email Address</span>
              <span className="text-lg font-medium">{user.email}</span>
            </div>
            <div>
              <span className="font-semibold text-sm text-muted-foreground block">Account Role</span>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={user.role === "ADMIN" ? "default" : "outline"}>
                  {user.role === "ADMIN" ? "ADMIN" : user.userType === "DRIVER" ? "DRIVER" : user.userType === "PASSENGER" ? "PASSENGER / STUDENT" : "DRIVER & PASSENGER"}
                </Badge>
              </div>
            </div>
            <div>
              <span className="font-semibold text-sm text-muted-foreground block">Gender</span>
              <span className="text-base font-medium">
                {user.gender === "FEMALE" ? "Female" : user.gender === "MALE" ? "Male" : user.gender === "OTHER" ? "Other" : "Prefer not to say"}
              </span>
            </div>
            <div>
              <span className="font-semibold text-sm text-muted-foreground block">Community Rating</span>
              <span className="text-base font-semibold text-amber-600 dark:text-amber-400">
                {isStrictDriverOnly && (
                  driverAverageRating ? `★ ${driverAverageRating} / 5 (${driverRatingCount} ${driverRatingCount === 1 ? 'review' : 'reviews'})` : "No ratings yet"
                )}
                {isStrictPassengerOnly && (
                  passengerAverageRating ? `★ ${passengerAverageRating} / 5 (${passengerRatingCount} ${passengerRatingCount === 1 ? 'review' : 'reviews'})` : "No ratings yet"
                )}
                {user.userType === "BOTH" && (
                  <span className="text-sm space-y-1 block">
                    <span>Driver: {driverAverageRating ? `★ ${driverAverageRating} / 5 (${driverRatingCount})` : "No driver ratings yet"}</span>
                    <br />
                    <span>Passenger: {passengerAverageRating ? `★ ${passengerAverageRating} / 5 (${passengerRatingCount})` : "No passenger ratings yet"}</span>
                  </span>
                )}
              </span>
            </div>
          </div>

          <div>
            <span className="font-semibold text-sm text-muted-foreground block mb-1">Verification Badges</span>
            <div className="flex flex-wrap gap-2">
              {isPassengerRole && (
                user.studentVerificationStatus === "APPROVED" ? (
                  <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">✓ Verified Student</Badge>
                ) : (
                  <Badge variant="outline">Student ID: {user.studentVerificationStatus}</Badge>
                )
              )}
              {isDriverRole && (
                user.driverVerificationStatus === "APPROVED" ? (
                  <Badge variant="default" className="bg-blue-600 hover:bg-blue-700">✓ Verified Driver</Badge>
                ) : (
                  <Badge variant="outline">Driver License: {user.driverVerificationStatus}</Badge>
                )
              )}
            </div>
          </div>

          <div>
            <span className="font-semibold text-sm text-muted-foreground block">Member Since</span>
            <span className="text-base">{new Date(user.createdAt).toLocaleDateString()}</span>
          </div>

          <div className="pt-4 border-t">
            <ProfileAccountForm
              initialPhone={user.phoneNumber}
              initialGender={user.gender}
            />
          </div>
        </CardContent>
      </Card>

      {/* DRIVER REVIEWS CARD (shown for DRIVER or BOTH) */}
      {isDriverRole && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span>⭐ Reviews from Passengers</span>
                </CardTitle>
                <CardDescription>
                  Feedback given by passengers on your completed rides as a driver.
                </CardDescription>
              </div>
              {driverAverageRating && (
                <Badge variant="secondary" className="text-base px-3 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                  ★ {driverAverageRating} / 5 ({driverRatingCount})
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {driverRatingCount === 0 ? (
              <p className="text-sm text-muted-foreground">No passenger reviews yet.</p>
            ) : (
              <div className="space-y-4">
                {driverRatingsReceived.map((r) => (
                  <div key={r.id} className="p-4 rounded-lg border bg-card space-y-1 text-sm">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="text-amber-500">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                        <span>from Passenger: <strong className="text-foreground">{r.reviewer.name}</strong></span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {r.ride && (
                      <p className="text-xs text-muted-foreground">
                        Ride: {r.ride.origin} → {r.ride.destination}
                      </p>
                    )}
                    {r.review && (
                      <p className="text-sm italic pt-1 text-foreground">&quot;{r.review}&quot;</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* PASSENGER REVIEWS CARD (shown for PASSENGER or BOTH) */}
      {isPassengerRole && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span>⭐ Reviews from Drivers</span>
                </CardTitle>
                <CardDescription>
                  Feedback given by drivers on your completed rides as a passenger.
                </CardDescription>
              </div>
              {passengerAverageRating && (
                <Badge variant="secondary" className="text-base px-3 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                  ★ {passengerAverageRating} / 5 ({passengerRatingCount})
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {passengerRatingCount === 0 ? (
              <p className="text-sm text-muted-foreground">No driver reviews yet.</p>
            ) : (
              <div className="space-y-4">
                {passengerRatingsReceived.map((r) => (
                  <div key={r.id} className="p-4 rounded-lg border bg-card space-y-1 text-sm">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="text-amber-500">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                        <span>from Driver: <strong className="text-foreground">{r.reviewer.name}</strong></span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {r.ride && (
                      <p className="text-xs text-muted-foreground">
                        Ride: {r.ride.origin} → {r.ride.destination}
                      </p>
                    )}
                    {r.review && (
                      <p className="text-sm italic pt-1 text-foreground">&quot;{r.review}&quot;</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* PASSENGER SAFETY CARD */}
      {isPassengerRole && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="flex items-center gap-2">
                <span>🛡️ Safety &amp; Emergency Information</span>
              </CardTitle>
              {hasEmergencyContact && (
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">
                  🛡️ Emergency contact configured
                </Badge>
              )}
            </div>
            <CardDescription>
              Your emergency contact will be used for safety notifications and emergency assistance during rides.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileSafetyForm
              initialGender={user.gender}
              initialEmergencyContactName={user.emergencyContactName}
              initialEmergencyContactEmail={user.emergencyContactEmail}
              initialEmergencyContactPhone={user.emergencyContactPhone}
            />
          </CardContent>
        </Card>
      )}

      {/* TRUSTED & EMERGENCY CONTACTS (FOR BOTH PASSENGERS AND DRIVERS) */}
      <Card>
        <CardHeader>
          <CardTitle>Trusted &amp; Emergency Contacts</CardTitle>
          <CardDescription>
            Manage personal and emergency contacts for instant trip sharing and emergency notifications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContactManagement />
        </CardContent>
      </Card>

      {/* BLOCKED USERS MANAGEMENT */}
      <Card>
        <CardHeader>
          <CardTitle>Safety &amp; Blocked Accounts</CardTitle>
          <CardDescription>
            Manage users you have restricted from booking, chatting, or matching with you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BlockedUsersList />
        </CardContent>
      </Card>
    </div>
  );
}
