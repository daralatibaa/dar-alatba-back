import { ok } from "@/lib/http";
import { handle } from "@/lib/route";
import { STORE, freeShippingThresholdFromTicker, getEditableStoreSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async () => {
  const freeShippingFrom = await freeShippingThresholdFromTicker();
  const editable = await getEditableStoreSettings();
  return ok(
    {
      ...STORE,
      ...editable,
      freeShippingFrom,
    },
    "إعدادات المتجر",
  );
});
