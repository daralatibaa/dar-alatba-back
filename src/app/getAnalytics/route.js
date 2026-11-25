import { getAnalytics } from "@/lib/analytics";
import { ok } from "@/lib/http";
import { handle } from "@/lib/route";

export const runtime = "nodejs";

export const GET = handle(async (request) => {
  const days = Number(new URL(request.url).searchParams.get("days"));
  return ok(await getAnalytics(days), "تحليلات الطلبات", 200, {
    "Cache-Control": "private, max-age=60",
  });
});
