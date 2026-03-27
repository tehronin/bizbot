import path from "path";

const DEFAULT_WORKSPACE_DIRNAME = "workspace";

export function getAppHomeDir(): string {
  const configuredHome = process.env.BIZBOT_HOME_DIR;
  if (configuredHome && configuredHome.trim().length > 0) {
    return path.resolve(/* turbopackIgnore: true */ configuredHome);
  }

  return path.resolve(/* turbopackIgnore: true */ process.cwd());
}

export function resolveFromAppHome(...segments: string[]): string {
  return path.resolve(
    /* turbopackIgnore: true */ getAppHomeDir(),
    ...segments.map((segment) => /* turbopackIgnore: true */ segment),
  );
}

export function getDefaultWorkspaceDirname(): string {
  return DEFAULT_WORKSPACE_DIRNAME;
}