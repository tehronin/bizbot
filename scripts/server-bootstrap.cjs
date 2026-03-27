const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1");
    process.env[key] = value;
  }
}

const target = process.argv[2];
if (!target) {
  console.error("[bootstrap] missing target script argument");
  process.exit(1);
}

loadEnvFile(process.env.BIZBOT_ENV_PATH);
require(path.resolve(target));