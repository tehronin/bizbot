import { NextRequest } from "next/server";
import {
  createExternalPlugin,
  getPluginCatalog,
  removeExternalPlugin,
  setBuiltinPluginEnabled,
  setExternalPluginEnabled,
  updateExternalPlugin,
  type ExternalPluginConfigInput,
} from "@/lib/agent/plugins/catalog";

interface PluginMutationRequest {
  pluginId?: string;
  kind?: "builtin" | "external";
  enabled?: boolean;
  config?: ExternalPluginConfigInput;
}

export async function GET() {
  try {
    return Response.json(await getPluginCatalog());
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as PluginMutationRequest;
    if (!body.pluginId || !body.kind || typeof body.enabled !== "boolean") {
      return Response.json({ error: "pluginId, kind, and enabled are required." }, { status: 400 });
    }

    if (body.kind === "builtin") {
      setBuiltinPluginEnabled(body.pluginId, body.enabled);
    } else {
      await setExternalPluginEnabled(body.pluginId, body.enabled);
    }

    return Response.json(await getPluginCatalog());
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PluginMutationRequest;
    if (body.kind !== "external" || !body.config) {
      return Response.json({ error: "External plugin config is required." }, { status: 400 });
    }

    await createExternalPlugin(body.config);
    return Response.json(await getPluginCatalog());
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as PluginMutationRequest;
    if (body.kind !== "external" || !body.pluginId || !body.config) {
      return Response.json({ error: "pluginId and external plugin config are required." }, { status: 400 });
    }

    await updateExternalPlugin(body.pluginId, body.config);
    return Response.json(await getPluginCatalog());
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as PluginMutationRequest;
    if (!body.pluginId || body.kind !== "external") {
      return Response.json({ error: "Only external plugins can be removed." }, { status: 400 });
    }

    await removeExternalPlugin(body.pluginId);
    return Response.json(await getPluginCatalog());
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}