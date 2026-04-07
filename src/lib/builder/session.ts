const activeBuilderRunControllers = new Map<string, AbortController>();

export function registerBuilderRunController(runId: string, controller: AbortController): void {
  activeBuilderRunControllers.set(runId, controller);
}

export function unregisterBuilderRunController(runId: string): void {
  activeBuilderRunControllers.delete(runId);
}

export function hasBuilderRunController(runId: string): boolean {
  return activeBuilderRunControllers.has(runId);
}

export function cancelBuilderRunController(runId: string): boolean {
  const controller = activeBuilderRunControllers.get(runId);
  if (!controller) {
    return false;
  }

  controller.abort(new Error("Builder run cancelled by user."));
  return true;
}