import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export function loadLocalEnv(options = {}) {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const envFiles = [".env.example", ".env", ".env.local"];

  for (const envFile of envFiles) {
    const envPath = path.join(workspaceRoot, envFile);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    dotenv.config({
      path: envPath,
      override: true,
      processEnv: env,
      quiet: true,
    });
  }

  return env;
}