import { readBody } from "@/lib/body";
import { ok } from "@/lib/http";
import { updatePolicy } from "@/lib/policies";
import { handle } from "@/lib/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PUT = handle(async (request) => {
  const { fields } = await readBody(request);
  return ok(await updatePolicy("shipping", fields), "تم تحديث صفحة الشحن");
});
