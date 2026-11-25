import { cached } from "./cache";
import { Order, Product } from "./models";

const PAYMENTS = {
  cod: { ar: "الدفع عند الاستلام", en: "Cash on delivery" },
  instapay: { ar: "إنستاباي", en: "Instapay" },
  vodafone: { ar: "فودافون كاش", en: "Vodafone Cash" },
  "": { ar: "غير محددة", en: "Unspecified" },
};

function dayKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function rangeDays(days) {
  const keys = [];
  const cursor = new Date();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - index);
    keys.push(dayKey(date));
  }
  return keys;
}

export async function getAnalytics(rawDays) {
  const days = rawDays === 7 ? 7 : 30;
  return cached(`analytics:${days}`, 120 * 1000, () => computeAnalytics(days));
}

async function computeAnalytics(days) {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const orders = await Order.find({
    createdAt: { $gte: since },
    status: { $ne: "cancelled" },
  })
    .select("createdAt payableTotal totalPrice paymentMethod governorate items")
    .limit(1000)
    .lean();

  const keys = rangeDays(days);
  const byDay = new Map(keys.map((key) => [key, { date: key, revenue: 0, orders: 0 }]));
  const payments = new Map();
  const categories = new Map();
  const regions = new Map();
  const products = new Map();
  let revenue = 0;

  for (const order of orders) {
    const payable = Number(order.payableTotal || order.totalPrice || 0);
    revenue += payable;
    const key = dayKey(order.createdAt);
    const day = byDay.get(key);
    if (day) {
      day.revenue += payable;
      day.orders += 1;
    }

    const method = PAYMENTS[order.paymentMethod] ? order.paymentMethod : "";
    const payment = payments.get(method) || { ...PAYMENTS[method], id: method || "other", count: 0 };
    payment.count += 1;
    payments.set(method, payment);

    const region = order.governorate || "غير محددة";
    regions.set(region, (regions.get(region) || 0) + 1);

    for (const item of order.items || []) {
      const id = item.product ? String(item.product) : item.name;
      const lineRevenue = Number(item.price || 0) * Number(item.quantity || 0);
      const current = products.get(id) || {
        id,
        units: 0,
        revenue: 0,
        image: item.image || "",
        name: item.name || "",
        price: Number(item.price) || 0,
      };
      current.units += Number(item.quantity) || 0;
      current.revenue += lineRevenue;
      products.set(id, current);

      }
  }

  const productIds = [...products.keys()].filter((id) => id && id.length === 24);
  const productDocs = await Product.find({ _id: { $in: productIds } }).populate("category", "nameAr nameEn");
  const categoryOf = new Map(productDocs.map((product) => [String(product._id), product.category]));
  const imageOf = new Map(
    productDocs.map((product) => {
      const images = Array.isArray(product.images) ? product.images : [];
      const live = images.find((image) => image?.url && !/res\.cloudinary\.com/i.test(image.url))?.url
        || images[0]?.url
        || "";
      return [String(product._id), live];
    }),
  );
  for (const item of products.values()) {
    const category = categoryOf.get(item.id);
    const ar = category?.nameAr || "بدون قسم";
    const en = category?.nameEn || ar;
    const current = categories.get(ar) || { ar, en, value: 0 };
    current.value += item.revenue;
    categories.set(ar, current);
    const liveImage = imageOf.get(item.id) || "";
    if (liveImage && (!item.image || /res\.cloudinary\.com/i.test(item.image))) {
      item.image = liveImage;
    }
  }

  const orderCount = orders.length;
  const paymentItems = [...payments.values()];
  const paymentTotal = paymentItems.reduce((sum, item) => sum + item.count, 0) || 1;

  return {
    days,
    revenue,
    orders: orderCount,
    average: orderCount ? Math.round(revenue / orderCount) : 0,
    visitors: null,
    conversion: null,
    series: keys.map((key) => byDay.get(key)),
    payments: paymentItems.map((item) => ({
      id: item.id,
      ar: item.ar,
      en: item.en,
      share: Math.round((item.count / paymentTotal) * 100),
      count: item.count,
    })),
    categories: [...categories.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    regions: [...regions.entries()]
      .map(([name, value]) => ({ ar: name, en: name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    products: [...products.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        units: item.units,
        revenue: item.revenue,
        image: item.image,
        price: item.price,
        name: { ar: { name: item.name }, en: { name: item.name } },
      })),
  };
}
