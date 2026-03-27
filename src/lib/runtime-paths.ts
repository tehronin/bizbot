import path from "path";

export function getAppHomeDir(): string {
  const configuredHome = process.env.BIZBOT_HOME_DIR;
  if (configuredHome && configuredHome.trim().length > 0) {
    return path.resolve(configuredHome);
  }

  return path.resolve(process.cwd());
}

export function resolveFromAppHome(...segments: string[]): string {
  return path.resolve(getAppHomeDir(), ...segments);
}