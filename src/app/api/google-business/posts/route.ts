import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  return NextResponse.redirect(new URL("/api/local-business/posts", req.url), { status: 307 });
}