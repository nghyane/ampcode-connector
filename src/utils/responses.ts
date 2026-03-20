export function apiError(status: number, message: string, type = "api_error"): Response {
  return Response.json({ error: { message, type, code: String(status) } }, { status });
}
