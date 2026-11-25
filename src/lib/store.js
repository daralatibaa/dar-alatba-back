import { cached, invalidate } from "./cache";
import { ApiError } from "./http";
import { StoreSettings } from "./models";
import { listAnnouncements } from "./announcements";

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Flat shipping fee when the free-shipping threshold from the ticker is not met. */
export const STORE = {
  // Fixed storefront shipping: 85 EGP (free only when cart meets freeShippingFrom).
  shippingFee: 85,
  freeShippingFrom: 3700,
  embroideryPrice: numberEnv("EMBROIDERY_PRICE", 0),
  setDiscountPercent: 15,
  shopPageSize: 12,
};

const ALLOWED_PAGE_SIZES = [6, 9, 12, 15, 18, 24, 36, 48];

function parseShopPageSize(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const order = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(order)) return null;
  return ALLOWED_PAGE_SIZES.includes(order) ? order : null;
}

async function ensureStoreSettings() {
  let item = await StoreSettings.findOne({ key: "store" });
  if (item) return item;
  item = await StoreSettings.create({ key: "store", shopPageSize: STORE.shopPageSize });
  return item;
}

export async function getEditableStoreSettings() {
  const item = await ensureStoreSettings();
  return {
    shopPageSize: parseShopPageSize(item.shopPageSize) || STORE.shopPageSize,
  };
}

export async function getPublicStoreSettings() {
  return cached("store:settings", 60 * 1000, async () => {
    const freeShippingFrom = await freeShippingThresholdFromTicker();
    const editable = await getEditableStoreSettings();
    return {
      ...STORE,
      ...editable,
      freeShippingFrom,
    };
  });
}

export async function updateEditableStoreSettings(fields) {
  const item = await ensureStoreSettings();
  if (fields.shopPageSize === undefined || fields.shopPageSize === "") {
    throw new ApiError("عدد المنتجات المعروضة مطلوب");
  }
  const shopPageSize = parseShopPageSize(fields.shopPageSize);
  if (shopPageSize == null) {
    throw new ApiError("اختر عدد منتجات صالح: 6 أو 9 أو 12 أو 15 أو 18 أو 24 أو 36 أو 48");
  }
  item.shopPageSize = shopPageSize;
  await item.save();
  invalidate("store:settings");
  return {
    shopPageSize: item.shopPageSize,
  };
}

/** Read the free-shipping amount from ticker / announcement copy (e.g. "فوق 3700"). */
export function parseFreeShippingThreshold(...texts) {
  const joined = texts.filter(Boolean).join(" ");
  if (!joined) return null;
  const western = joined.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const hinted = western.match(/(?:فوق|أكثر من|over|above|from)\s*(\d[\d,]*)/i);
  if (hinted) {
    const value = Number(hinted[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) return value;
  }
  const amounts = [...western.matchAll(/\d[\d,]*/g)]
    .map((match) => Number(match[0].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 200);
  return amounts.length ? Math.max(...amounts) : null;
}

export async function freeShippingThresholdFromTicker() {
  const announcements = await listAnnouncements(true);
  const fromTicker = parseFreeShippingThreshold(
    ...announcements.flatMap((item) => [item.textAr, item.textEn, item.text]),
  );
  if (fromTicker != null) return fromTicker;
  const fallback = Number(STORE.freeShippingFrom);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

export async function shippingFeeFor(productsTotal) {
  const total = Number(productsTotal) || 0;
  const threshold = await freeShippingThresholdFromTicker();
  if (threshold != null && total >= threshold) return 0;
  return STORE.shippingFee;
}
