import { listLeadPipeline } from "@/lib/inbox/leads";

export async function GET() {
  const leads = await listLeadPipeline();
  return Response.json({ leads });
}