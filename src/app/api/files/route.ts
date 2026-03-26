/**
 * GET    /api/files          – list workspace files
 * POST   /api/files          – write a file
 * DELETE /api/files?path=x   – delete a file
 */

import { NextRequest } from "next/server";
import { listFiles, readFile, writeFile, deleteFile } from "@/lib/files/workspace";

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (filePath) {
    const content = await readFile(filePath);
    return Response.json({ path: filePath, content });
  }
  const files = await listFiles();
  return Response.json({ files });
}

export async function POST(req: NextRequest) {
  try {
    const { path, content } = (await req.json()) as { path: string; content: string };
    await writeFile(path, content);
    return Response.json({ written: true, path }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const filePath = req.nextUrl.searchParams.get("path");
    if (!filePath) return Response.json({ error: "path required" }, { status: 400 });
    await deleteFile(filePath);
    return Response.json({ deleted: true, path: filePath });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
