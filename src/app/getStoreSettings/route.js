import { publicOk } from "@/lib/http";
import { handle } from "@/lib/route";
import { getPublicStoreSettings } from "@/lib/store";

export const runtime = "nodejs";

export const GET = handle(async () => publicOk(await getPublicStoreSettings(), "إعدادات المتجر", 60));
