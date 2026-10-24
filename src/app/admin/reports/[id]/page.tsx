import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminReportActions } from "./AdminReportActions";

export const dynamic = "force-dynamic";

export default async function AdminReportDetailPage({ params }: { params: { id: string } }) {
  const report = await prisma.report.findUnique({
    where: { id: params.id },
    include: {
      reporter: { select: { id: true, name: true, email: true } },
      reportedUser: { select: { id: true, name: true, email: true, status: true } },
      ride: { select: { id: true, origin: true, destination: true } },
    },
  });

  if (!report) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/reports" className="text-xs text-muted-foreground hover:text-primary mb-2 inline-block">
          ← Back to Reports
        </Link>
        <div className="flex justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Report Review</h1>
            <p className="text-muted-foreground mt-1">Submitted on {new Date(report.createdAt).toLocaleString()}</p>
          </div>
          <Badge variant={report.status === "RESOLVED" ? "default" : report.status === "PENDING" ? "outline" : "secondary"}>
            {report.status}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-4">
          <h3 className="font-semibold text-base border-b pb-2">Reporter Details</h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">Name</span>
              <span className="font-semibold">{report.reporter.name}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Email</span>
              <span>{report.reporter.email}</span>
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="font-semibold text-base border-b pb-2">Report Details</h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">Reported Subject</span>
              {report.reportedUser ? (
                <span className="font-semibold">User: {report.reportedUser.name} ({report.reportedUser.email})</span>
              ) : report.ride ? (
                <span className="font-semibold">Ride: {report.ride.origin} → {report.ride.destination}</span>
              ) : (
                <span>General Platform Feedback</span>
              )}
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Reason</span>
              <p className="bg-muted/50 p-3 rounded-md border mt-1 font-medium">{report.reason}</p>
            </div>
            {report.description && (
              <div>
                <span className="text-xs text-muted-foreground block">Description / Details</span>
                <p className="bg-muted/50 p-3 rounded-md border mt-1 whitespace-pre-wrap">{report.description}</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <AdminReportActions
          reportId={report.id}
          reportedUserId={report.reportedUser?.id}
          reportedUserName={report.reportedUser?.name}
          reportedUserStatus={report.reportedUser?.status}
        />
      </Card>
    </div>
  );
}
