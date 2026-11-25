import { listColors } from "@/lib/catalogService";
import { publicOk } from "@/lib/http";
import { handle } from "@/lib/route";

export const runtime = "nodejs";

export const GET = handle(async () => publicOk(await listColors(), "تم جلب الألوان", 120));
