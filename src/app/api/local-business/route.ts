import { NextRequest } from "next/server";
import { getGoogleBusinessDashboard, updateGoogleBusinessHours } from "@/lib/google-business/service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(req: NextRequest) {
  try {
    const syncRemote = req.nextUrl.searchParams.get("sync") === "true";
    const dashboard = await getGoogleBusinessDashboard(syncRemote);
    return Response.json(dashboard);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isRecord(body) || !Array.isArray(body.periods)) {
      return Response.json({ error: "Hours payload requires a periods array." }, { status: 400 });
    }

    const location = await updateGoogleBusinessHours({
      periods: body.periods.filter(isRecord).map((period) => ({
        openDay: String(period.openDay ?? "MONDAY"),
        openTime: String(period.openTime ?? "09:00"),
        closeDay: String(period.closeDay ?? period.openDay ?? "MONDAY"),
        closeTime: String(period.closeTime ?? "17:00"),
      })),
    });

    return Response.json({ location });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}