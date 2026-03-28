import { NextRequest, NextResponse } from "next/server";

function redirectToLocalBusiness(req: NextRequest): NextResponse {
  const nextUrl = new URL("/api/local-business", req.url);
  nextUrl.search = req.nextUrl.search;
  return NextResponse.redirect(nextUrl, { status: 307 });
}

export async function GET(req: NextRequest) {
  return redirectToLocalBusiness(req);
}

export async function PATCH(req: NextRequest) {
  return redirectToLocalBusiness(req);
}