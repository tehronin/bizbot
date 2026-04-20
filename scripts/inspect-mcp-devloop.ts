import { loadLocalEnv } from "./load-local-env.mjs";
import { buildMcpHealthSnapshot } from "@/lib/mcp/health";

async function main() {
  loadLocalEnv({ workspaceRoot: process.cwd(), env: process.env });
  const snapshot = await buildMcpHealthSnapshot();
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
