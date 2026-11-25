import { listSizes } from "@/lib/catalogService";
import { publicOk } from "@/lib/http";
import { handle } from "@/lib/route";

export const runtime = "nodejs";

export const GET = handle(async () => publicOk(await listSizes(), "تم جلب المقاسات", 120));
