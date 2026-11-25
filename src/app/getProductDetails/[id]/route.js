import { getProduct } from "@/lib/catalogService";
import { publicOk } from "@/lib/http";
import { handle } from "@/lib/route";

export const runtime = "nodejs";

export const GET = handle(async (_request, context) => {
  const { id } = await context.params;
  return publicOk(await getProduct(id), "تم جلب تفاصيل المنتج", 60);
});
