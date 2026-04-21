export class ApiRouteError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiRouteError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function apiErrorResponse(error: unknown, logContext?: string): Response {
  if (error instanceof ApiRouteError) {
    return Response.json(
      error.details === undefined
        ? { error: error.message, code: error.code }
        : { error: error.message, code: error.code, details: error.details },
      { status: error.status },
    );
  }

  if (logContext) {
    console.error(logContext, error);
  }

  return Response.json(
    { error: "Internal server error.", code: "internal_error" },
    { status: 500 },
  );
}