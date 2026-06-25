/**
 * Uniform error envelope — API_Contract §1.2
 * Every non-2xx response from /api/v1/* uses this shape.
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

/** Convenience type guard */
export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiError).error?.code === "string"
  );
}
