import { connectDB } from "./db";
import { withCors } from "./cors";
import { fail } from "./http";

export function handle(handler) {
  return async (request, context) => {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request);
    }
    try {
      await connectDB();
      const response = await handler(request, context);
      return withCors(response, request);
    } catch (error) {
      return withCors(fail(error), request);
    }
  };
}
