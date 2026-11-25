import mongoose from "mongoose";
import { firstFile, requiredText, textValue } from "./body";
import { sendOrderWhatsapp } from "./beon";
import { deleteImage, uploadImage } from "./storage";
import { ApiError } from "./http";
import { Order, Product } from "./models";
import { STORE, shippingFeeFor } from "./store";

function assertObjectId(value, label) {
  const id = textValue(value);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(`${label} غير صالح`);
  }
  return id;
}

function sameOption(left, right) {
  return (left ? String(left) : "") === (right ? String(right) : "");
}

async function takeStock(productId, sizeId, colorId, quantity) {
  const product = await Product.findById(productId);
  if (!product || product.isActive === false) {
    throw new ApiError("أحد المنتجات لم يعد متاحاً", 404);
  }

  if (product.variants?.length) {
    const variant = product.variants.find(
      (item) => sameOption(item.size, sizeId) && sameOption(item.color, colorId),
    );
    if (!variant) throw new ApiError("هذا المقاس أو اللون غير متوفر", 400);

    const updated = await Product.updateOne(
      {
        _id: product._id,
        "variants._id": variant._id,
        "variants.stock": { $gte: quantity },
      },
      { $inc: { "variants.$.stock": -quantity, stock: -quantity } },
    );
    if (!updated.modifiedCount) throw new ApiError("الكمية المطلوبة غير متوفرة", 400);
    return { productId: product._id, variantId: variant._id, quantity };
  }

  const updated = await Product.updateOne(
    { _id: product._id, stock: { $gte: quantity } },
    { $inc: { stock: -quantity } },
  );
  if (!updated.modifiedCount) throw new ApiError("الكمية المطلوبة غير متوفرة", 400);
  return { productId: product._id, variantId: null, quantity };
}

async function giveBack(productId, sizeId, colorId, quantity) {
  const product = await Product.findById(productId);
  if (!product || !quantity) return;
  const variants = product.variants || [];
  const variant =
    variants.find((item) => sameOption(item.size, sizeId) && sameOption(item.color, colorId)) ||
    variants.find((item) => sameOption(item.size, sizeId) && !item.color);
  if (variant) {
    await Product.updateOne(
      { _id: product._id, "variants._id": variant._id },
      { $inc: { "variants.$.stock": quantity, stock: quantity } },
    );
    return;
  }
  await Product.updateOne({ _id: product._id }, { $inc: { stock: quantity } });
}

async function restoreOrderStock(order) {
  if (!order || order.stockRestored) return;
  for (const line of order.items || []) {
    if (!line.product || !line.quantity) continue;
    await giveBack(line.product, line.sizeId, line.colorId, line.quantity);
    if (line.pantsSizeId && !sameOption(line.pantsSizeId, line.sizeId)) {
      await giveBack(line.product, line.pantsSizeId, line.colorId, line.quantity);
    }
  }
  order.stockRestored = true;
}

function embroideryNoteFrom(fields, notes) {
  const direct = textValue(fields.embroidery || fields.embroideryNote).slice(0, 200);
  if (direct) return direct;
  const match = String(notes || "").match(/تطريز:\s*(.+)/);
  return match ? match[1].trim().slice(0, 200) : "";
}

async function restoreStock(holds) {
  for (const hold of holds) {
    if (hold.variantId) {
      await Product.updateOne(
        { _id: hold.productId, "variants._id": hold.variantId },
        { $inc: { "variants.$.stock": hold.quantity, stock: hold.quantity } },
      );
    } else {
      await Product.updateOne(
        { _id: hold.productId },
        { $inc: { stock: hold.quantity } },
      );
    }
  }
}

const PAYMENT_METHODS = new Set(["cod", "instapay", "vodafone"]);

function paymentMethodFrom(value) {
  const method = textValue(value).toLowerCase();
  if (!method) return "";
  if (!PAYMENT_METHODS.has(method)) throw new ApiError("طريقة الدفع غير صالحة");
  return method;
}

function readItems(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(textValue(value) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new ApiError("بيانات المنتجات غير صالحة");
  }
}

function sameColorId(left, right) {
  return (left ? String(left) : "") === (right ? String(right) : "");
}

/** Cloudinary account for this store is no longer publicly readable (401). */
function isBrokenImageUrl(url) {
  const value = String(url || "");
  if (!value) return true;
  return /res\.cloudinary\.com/i.test(value);
}

function imageFromProduct(product, colorId = "") {
  const images = Array.isArray(product?.images) ? product.images.filter((item) => item?.url) : [];
  if (!images.length) return "";
  const firstUsable = (list) =>
    list.find((image) => !isBrokenImageUrl(image.url))?.url || list[0]?.url || "";
  if (colorId) {
    const matched = images.filter((image) => sameColorId(image.colorId, colorId));
    if (matched.length) {
      const hit = firstUsable(matched);
      if (hit && !isBrokenImageUrl(hit)) return hit;
    }
  }
  return firstUsable(images);
}

function resolveLineImage(line, productById) {
  const stored = String(line?.image || "");
  if (stored && !isBrokenImageUrl(stored)) return stored;
  const product = productById.get(String(line?.product || ""));
  return imageFromProduct(product, line?.colorId) || stored || "";
}

function serialize(order, productById = null) {
  const item = order.toObject ? order.toObject() : order;
  return {
    ...item,
    _id: String(item._id),
    items: (item.items || []).map((line) => ({
      ...line,
      product: line.product ? String(line.product) : null,
      image: productById
        ? resolveLineImage({ ...line, product: line.product ? String(line.product) : "" }, productById)
        : line.image || "",
    })),
  };
}

async function productImageMap(orders) {
  const ids = [
    ...new Set(
      (orders || [])
        .flatMap((order) => order.items || [])
        .map((line) => (line.product ? String(line.product) : ""))
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  if (!ids.length) return new Map();
  const products = await Product.find({ _id: { $in: ids } }).select("images");
  return new Map(products.map((product) => [String(product._id), product]));
}

export async function createOrder(fields, files) {
  const customerName = requiredText(fields.customerName, "اسم العميل", 120);
  const customerPhone = requiredText(fields.customerPhone, "هاتف العميل", 30);
  const governorate = requiredText(fields.governorate, "المحافظة", 80);
  const detailedAddress = requiredText(fields.detailedAddress, "العنوان", 500);
  const transferPhone = textValue(fields.transferPhone).slice(0, 40);
  const notes = textValue(fields.notes).slice(0, 4000);
  const paymentMethod = paymentMethodFrom(fields.paymentMethod);
  const rawItems = readItems(fields.items);

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError("السلة فارغة");
  }

  const receipt = firstFile(files, "transferImage");
  if (paymentMethod !== "cod" && !receipt) {
    throw new ApiError("صورة إيصال التحويل مطلوبة");
  }

  const lines = [];
  for (const raw of rawItems) {
    const productId = assertObjectId(raw.productId || raw.product, "المنتج");
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new ApiError("كمية المنتج غير صالحة");
    }
    const product = await Product.findById(productId);
    if (!product) throw new ApiError("أحد المنتجات غير موجود", 404);

    const topName = textValue(raw.topSizeName || raw.sizeName);
    const pantsName = textValue(raw.pantsSizeName);
    const pantsId = textValue(raw.pantsSizeId);
    const colorId = textValue(raw.colorId);
    const sizeLabel =
      pantsName && pantsName !== topName ? `توب ${topName} / بنطلون ${pantsName}` : topName;
    const variant = [sizeLabel, textValue(raw.colorName)].filter(Boolean).join(" / ");
    const clientImage = textValue(raw.image);
    const image =
      imageFromProduct(product, colorId) ||
      (!isBrokenImageUrl(clientImage) ? clientImage : "") ||
      "";
    lines.push({
      product: product._id,
      name: variant ? `${product.nameAr} (${variant})` : product.nameAr,
      price: product.price,
      quantity,
      image,
      sizeId: textValue(raw.sizeId),
      colorId,
      sizeName: sizeLabel,
      colorName: textValue(raw.colorName),
      pantsSizeId: pantsId,
      pantsSizeName: pantsName,
    });
  }

  const holds = [];
  try {
    for (const line of lines) {
      holds.push(await takeStock(line.product, line.sizeId, line.colorId, line.quantity));
      if (line.pantsSizeId && !sameOption(line.pantsSizeId, line.sizeId)) {
        holds.push(await takeStock(line.product, line.pantsSizeId, line.colorId, line.quantity));
      }
    }
  } catch (error) {
    await restoreStock(holds);
    throw error;
  }

  let transferImage = null;
  let order = null;
  try {
    if (receipt) transferImage = await uploadImage(receipt, "dar-alatba/orders");
    const productsTotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    // Always price shipping on the server (85, or 0 only above free-shipping threshold).
    // Do not trust client shippingFee — storefront 0 was zeroing orders on Vercel.
    const shippingFee = await shippingFeeFor(productsTotal);
    const embroideryNote = embroideryNoteFrom(fields, notes);
    const embroideryPrice = embroideryNote ? STORE.embroideryPrice : 0;
    const payableTotal = productsTotal + shippingFee + embroideryPrice;
    order = await Order.create({
      customerName,
      customerPhone,
      governorate,
      detailedAddress,
      transferPhone,
      paymentMethod,
      notes,
      embroideryNote,
      embroideryPrice,
      items: lines,
      productsTotal,
      shippingFee,
      payableTotal,
      totalPrice: payableTotal,
      transferImage,
      status: "pending",
      whatsapp: { status: "pending" },
    });

    try {
      order.whatsapp = await sendOrderWhatsapp(order);
    } catch (error) {
      order.whatsapp = {
        status: "failed",
        messageId: "",
        error: String(error.message || "تعذر إرسال رسالة واتساب").slice(0, 500),
        sentAt: null,
      };
    }
    await order.save();
    return serialize(order);
  } catch (error) {
    await restoreStock(holds);
    if (order?._id) await Order.deleteOne({ _id: order._id });
    if (transferImage?.public_id) await deleteImage(transferImage.public_id);
    throw error;
  }
}

export async function listOrders(status) {
  const filter =
    status === "pending"
      ? { status: { $in: ["pending", "received", "cancelled"] } }
      : { status };
  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(200);
  const productById = await productImageMap(orders);
  return orders.map((order) => serialize(order, productById));
}

function phoneMatches(storedPhone, incomingPhone) {
  const stored = String(storedPhone || "").replace(/\D/g, "");
  const incoming = String(incomingPhone || "").replace(/\D/g, "");
  if (stored.length < 8 || incoming.length < 8) return false;
  return stored.endsWith(incoming.slice(-10)) || incoming.endsWith(stored.slice(-10));
}

export async function markOrderReceived(phone, nextStatus = "received") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 8) throw new ApiError("رقم الهاتف غير صالح");

  const requested = String(nextStatus || "received").trim().toLowerCase();
  const status = requested === "canceled" || requested === "canceld" ? "cancelled" : requested;
  if (status !== "received" && status !== "cancelled") {
    throw new ApiError("الحالة يجب أن تكون received أو cancelled");
  }

  const orders = await Order.find({ status: { $in: ["pending", "received", "cancelled"] } })
    .sort({ createdAt: -1 })
    .limit(100);
  const order = orders.find((item) => phoneMatches(item.customerPhone, digits));
  if (!order) throw new ApiError("لا يوجد طلب معلّق لهذا الرقم", 404);

  if (status === "cancelled" && order.status !== "cancelled") {
    await restoreOrderStock(order);
  }
  order.status = status;
  order.whatsapp = {
    ...(order.whatsapp?.toObject?.() || order.whatsapp || {}),
    reply: status === "cancelled" ? "cancelled" : "confirmed",
    repliedAt: new Date(),
  };
  await order.save();

  return {
    _id: String(order._id),
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
  };
}

export async function completeOrder(id) {
  const order = await Order.findById(assertObjectId(id, "الطلب"));
  if (!order) throw new ApiError("الطلب غير موجود", 404);
  order.status = "completed";
  order.completedAt = new Date();
  await order.save();
  return serialize(order);
}

export async function deleteOrder(id) {
  const order = await Order.findById(assertObjectId(id, "الطلب"));
  if (!order) throw new ApiError("الطلب غير موجود", 404);
  await restoreOrderStock(order);
  await deleteImage(order.transferImage?.public_id);
  await order.deleteOne();
  return { _id: String(order._id) };
}

export async function applyWhatsappReply(phones, reply) {
  if (!reply || !phones?.length) return null;
  const needles = phones
    .map((phone) => String(phone).replace(/\D/g, ""))
    .filter((phone) => phone.length >= 8);

  const orders = await Order.find({ status: "pending" }).sort({ createdAt: -1 }).limit(100);
  const order = orders.find((item) => {
    const stored = String(item.customerPhone || "").replace(/\D/g, "");
    return needles.some(
      (phone) => stored.endsWith(phone.slice(-10)) || phone.endsWith(stored.slice(-10)),
    );
  });
  if (!order) return null;

  const nextStatus = reply === "cancelled" ? "cancelled" : reply === "confirmed" ? "received" : "";
  if (nextStatus && order.status !== "completed") {
    if (nextStatus === "cancelled" && order.status !== "cancelled") {
      await restoreOrderStock(order);
    }
    order.status = nextStatus;
  }
  order.whatsapp = {
    ...(order.whatsapp?.toObject?.() || order.whatsapp || {}),
    reply,
    repliedAt: new Date(),
  };
  await order.save();
  return order._id;
}
