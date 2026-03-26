import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const row = await db.setting.findFirst({ where: { key: "onboarding_completed" } });
  const completed = row?.value === "true";
  redirect(completed ? "/chat" : "/onboarding");
}
