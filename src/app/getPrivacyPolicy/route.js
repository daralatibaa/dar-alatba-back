import { publicOk } from "@/lib/http";
import { getPolicy } from "@/lib/policies";
import { handle } from "@/lib/route";

export const runtime = "nodejs";

export const GET = handle(async () =>
  publicOk(await getPolicy("privacy"), "تم جلب سياسة الخصوصية", 300),
);
