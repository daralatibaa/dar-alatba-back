import { listProducts } from "@/lib/catalogService";
import { publicOk } from "@/lib/http";
import { handle } from "@/lib/route";

export const runtime = "nodejs";

export const GET = handle(async (request) => {
  const categoryId = new URL(request.url).searchParams.get("categoryId");
  return publicOk(await listProducts(categoryId), "تم جلب المنتجات", 60);
});
