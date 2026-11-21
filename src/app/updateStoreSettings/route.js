import { readBody } from "@/lib/body";
import { ok } from "@/lib/http";
import { handle } from "@/lib/route";
import { STORE, freeShippingThresholdFromTicker, updateEditableStoreSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PUT = handle(async (request) => {
  const { fields } = await readBody(request);
  const editable = await updateEditableStoreSettings(fields);
  const freeShippingFrom = await freeShippingThresholdFromTicker();
  return ok(
    {
      ...STORE,
      ...editable,
      freeShippingFrom,
    },
    "تم تحديث إعدادات المتجر",
  );
});
