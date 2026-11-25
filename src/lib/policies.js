import { cached, invalidate } from "./cache";
import { ApiError } from "./http";
import { Policy } from "./models";

const KEYS = {
  privacy: {
    label: "سياسة الخصوصية",
    defaults: {
      titleAr: "سياسة الخصوصية",
      titleEn: "Privacy Policy",
      contentAr:
        "نستخدم بيانات الطلب مثل الاسم والهاتف والعنوان للتواصل وتوصيل الطلب، ولا نبيعها.\n\nيُحفظ حساب المتجر والمفضلة على خوادم دار الأطباء لتتمكن من فتح الحساب نفسه من أي جهاز بعد تسجيل الدخول.\n\nلإنهاء الجلسة على الجهاز، سجّل الخروج. ولحذف الحساب بالكامل، يُرجى التواصل معنا.",
      contentEn:
        "Order details such as your name, phone, and address are used to contact you and deliver the order. We do not sell them.\n\nYour shop account and favorites are stored on Dar Alatba servers so you can sign in from another device.\n\nTo end the session on this device, log out. To delete the account entirely, contact us.",
    },
  },
  returns: {
    label: "سياسة الاسترجاع",
    defaults: {
      titleAr: "سياسة الاسترجاع",
      titleEn: "Returns Policy",
      contentAr:
        "تقدر تطلب إرجاع خلال ١٤ يوم من استلام الطلب، لو القطعة لسه بحالتها الأصلية ومش مستخدمة.\n\nالإرجاع بيتم بعد التواصل على واتساب أو على 01007743765، وبنأكد حالة القطعة قبل استلامها.\n\nلو القطعة فيها عيب من عندنا، قول لنا وأرسل صورة عشان نبدّلها أو نرجّع قيمتها.",
      contentEn:
        "You can ask for a return within 14 days of receiving the order if the piece is still in its original condition and unused.\n\nReturns start on WhatsApp or at 01007743765. We confirm the piece before collecting it.\n\nIf a piece arrives with a fault, send us a photo so we can exchange it or refund it.",
    },
  },
  about: {
    label: "من نحن",
    defaults: {
      titleAr: "من نحن",
      titleEn: "About us",
      contentAr:
        "دار الأطباء (Dar Alatba) متجر للسكراب الطبي وملابس العيادة في مصر، للرجال والنساء.\n\nالموقع daralatba.com، ويتم الطلب والتأكيد عبر واتساب أو الهاتف 01007743765.",
      contentEn:
        "Dar Alatba (دار الأطباء) is a shop for medical scrubs and clinic apparel in Egypt, for men and women.\n\nThe site is daralatba.com. Orders are confirmed on WhatsApp or by phone at 01007743765.",
    },
  },
  terms: {
    label: "الشروط والأحكام",
    defaults: {
      titleAr: "الشروط والأحكام",
      titleEn: "Terms and conditions",
      contentAr:
        "يُؤكَّد الطلب بعد مراجعة البيانات والمقاس واللون والكمية. السعر المعروض بالجنيه المصري.\n\nطرق الدفع المتاحة عند إتمام الشراء: إنستاباي، فودافون كاش، أو الدفع عند الاستلام.\n\nاستخدام الموقع يعني أنك تشتري للاستخدام الشخصي أو لجهة عملك، ويجب أن تكون بيانات الطلب صحيحة لضمان التوصيل.",
      contentEn:
        "An order is confirmed after we review the details, size, color, and quantity. Prices are shown in Egyptian pounds.\n\nCheckout can be paid with Instapay, Vodafone Cash, or cash on delivery.\n\nUsing the site means you are buying for yourself or your workplace, and the order details need to be accurate for delivery.",
    },
  },
  shipping: {
    label: "الشحن",
    defaults: {
      titleAr: "الشحن",
      titleEn: "Shipping",
      contentAr:
        "توصّل دار الأطباء الطلبات داخل مصر.\n\nرسوم الشحن: ٨٥ جنيهًا على الطلب.\n\nالشحن مجاني للطلبات من ٣٧٠٠ جنيه فأكثر.\n\nمدة التوصيل تختلف حسب المحافظة، ويتم تأكيد الموعد عند مراجعة الطلب على واتساب أو الهاتف 01007743765.",
      contentEn:
        "Dar Alatba delivers orders across Egypt.\n\nShipping fee: 85 EGP per order.\n\nFree shipping on orders of 3700 EGP or more.\n\nDelivery time depends on the governorate. Timing is confirmed when the order is reviewed on WhatsApp or by phone at 01007743765.",
    },
  },
};

function assertKey(key) {
  if (!KEYS[key]) throw new ApiError("نوع السياسة غير صالح");
  return key;
}

function exactContent(value, label) {
  if (typeof value !== "string") throw new ApiError(`${label} مطلوب`);
  if (value.length === 0) throw new ApiError(`${label} مطلوب`);
  if (value.length > 50000) throw new ApiError(`${label} طويل جداً`);
  return value;
}

function exactTitle(value, label) {
  if (typeof value !== "string") throw new ApiError(`${label} مطلوب`);
  if (value.length === 0) throw new ApiError(`${label} مطلوب`);
  if (value.length > 200) throw new ApiError(`${label} طويل جداً`);
  return value;
}

function serialize(item) {
  return {
    _id: String(item._id),
    key: item.key,
    titleAr: item.titleAr || "",
    titleEn: item.titleEn || "",
    contentAr: item.contentAr || "",
    contentEn: item.contentEn || "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function ensurePolicy(key) {
  assertKey(key);
  let item = await Policy.findOne({ key });
  if (item) return item;
  item = await Policy.create({ key, ...KEYS[key].defaults });
  return item;
}

export async function getPolicy(key) {
  assertKey(key);
  return cached(`policy:${key}`, 5 * 60 * 1000, async () => {
    const item = await ensurePolicy(key);
    return serialize(item);
  });
}

export async function updatePolicy(key, fields) {
  assertKey(key);
  const item = await ensurePolicy(key);

  const titleAr = exactTitle(
    fields.titleAr !== undefined ? fields.titleAr : item.titleAr,
    "العنوان بالعربي",
  );
  const titleEn = exactTitle(
    fields.titleEn !== undefined ? fields.titleEn : item.titleEn,
    "العنوان بالإنجليزي",
  );
  const contentAr = exactContent(
    fields.contentAr !== undefined ? fields.contentAr : item.contentAr,
    "المحتوى بالعربي",
  );
  const contentEn = exactContent(
    fields.contentEn !== undefined ? fields.contentEn : item.contentEn,
    "المحتوى بالإنجليزي",
  );

  item.set({ titleAr, titleEn, contentAr, contentEn });
  await item.save();
  invalidate(`policy:${key}`);
  return serialize(item);
}

export function policyLabel(key) {
  return KEYS[assertKey(key)].label;
}
