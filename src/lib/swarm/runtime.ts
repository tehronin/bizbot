import type { SwarmExecutionPlan, SwarmRunOptions, SwarmTrace, SwarmWorkerResult, SwarmWorkItem } from "@/lib/swarm/types";

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function runWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  label: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        // Exponential backoff: 200ms, 400ms, …
        await new Promise<void>((resolve) => setTimeout(resolve, 200 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError ?? new Error(`${label} failed after ${maxRetries + 1} attempts`);
}

export async function executeSwarmPlan<TOutput extends Record<string, unknown>>(
  plan: SwarmExecutionPlan,
  worker: (workItem: SwarmWorkItem) => Promise<TOutput>,
  options?: SwarmRunOptions,
): Promise<{ results: SwarmWorkerResult[]; trace: SwarmTrace }> {
  const {
    concurrency = plan.workItems.length,
    itemTimeoutMs,
    maxRetries = 0,
    signal,
    onWorkItemComplete,
  } = options ?? {};

  const startedAt = new Date();
  const results: SwarmWorkerResult[] = [];
  const queue = [...plan.workItems];
  let active = 0;

  await new Promise<void>((resolve, reject) => {
    function tryDispatch() {
      while (active < concurrency && queue.length > 0) {
        if (signal?.aborted) break;

        const workItem = queue.shift()!;
        active++;

        const itemStartedAt = Date.now();

        const attempt = () => worker(workItem);
        const withRetry = maxRetries > 0
          ? () => runWithRetry(attempt, maxRetries, workItem.id)
          : attempt;
        const withTimeout = itemTimeoutMs !== undefined
          ? () => runWithTimeout(withRetry(), itemTimeoutMs, workItem.id)
          : withRetry;

        withTimeout().then(
          (output) => {
            const result: SwarmWorkerResult = {
              id: `${plan.id}:${workItem.id}`,
              workItemId: workItem.id,
              status: "completed",
              output,
              diagnostics: [],
              metrics: { durationMs: Date.now() - itemStartedAt },
            };
            results.push(result);
            onWorkItemComplete?.(result);
            active--;
            if (queue.length === 0 && active === 0) {
              resolve();
            } else {
              tryDispatch();
            }
          },
          (error: unknown) => {
            const result: SwarmWorkerResult = {
              id: `${plan.id}:${workItem.id}`,
              workItemId: workItem.id,
              status: "failed",
              output: {},
              diagnostics: [error instanceof Error ? error.message : String(error)],
              metrics: { durationMs: Date.now() - itemStartedAt },
            };
            results.push(result);
            onWorkItemComplete?.(result);
            active--;
            if (plan.failurePolicy === "fail_closed") {
              reject(error);
              return;
            }
            if (queue.length === 0 && active === 0) {
              resolve();
            } else {
              tryDispatch();
            }
          },
        );
      }

      // All items dispatched but signal was aborted — drain remaining
      if (signal?.aborted && queue.length > 0) {
        for (const skipped of queue.splice(0)) {
          const result: SwarmWorkerResult = {
            id: `${plan.id}:${skipped.id}`,
            workItemId: skipped.id,
            status: "failed",
            output: {},
            diagnostics: ["Aborted before dispatch"],
            metrics: { durationMs: 0 },
          };
          results.push(result);
          onWorkItemComplete?.(result);
        }
      }

      if (active === 0 && queue.length === 0) {
        resolve();
      }
    }

    if (plan.workItems.length === 0) {
      resolve();
    } else {
      tryDispatch();
    }
  });

  const finishedAt = new Date();
  // Restore original plan order
  const ordered = plan.workItems.map((wi) => results.find((r) => r.workItemId === wi.id)!).filter(Boolean);
  return {
    results: ordered,
    trace: {
      planId: plan.id,
      mode: plan.mode,
      workerCount: plan.workItems.length,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    },
  };
}