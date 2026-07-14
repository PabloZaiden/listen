import { errorResponse } from "@pablozaiden/webapp/server";
import { z } from "zod";

export function parseQuery<TSchema extends z.ZodTypeAny>(req: Request, schema: TSchema): z.infer<TSchema> | Response {
  const result = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (result.success) {
    return result.data;
  }
  return errorResponse(
    400,
    "invalid_request_query",
    "Query parameters failed validation",
    result.error.issues.map((issue) => ({
      path: issue.path.map((segment) => typeof segment === "symbol" ? String(segment) : segment),
      code: issue.code,
      message: issue.message,
    })),
  );
}
