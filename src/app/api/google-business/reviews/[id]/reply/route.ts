import { NextRequest, NextResponse } from "next/server";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return NextResponse.redirect(new URL(`/api/local-business/reviews/${id}/reply`, req.url), { status: 307 });
}