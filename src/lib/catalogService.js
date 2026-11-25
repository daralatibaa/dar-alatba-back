import mongoose from "mongoose";
import { deleteImage, uploadImage } from "./cloudinary";
import {
  fileList,
  firstFile,
  parseBoolean,
  parseJsonField,
  requiredText,
  textValue,
} from "./body";
import { ApiError } from "./http";
import { Category, Color, Order, Product, Size } from "./models";

const productPopulate = [
  {
    path: "category",
    select: "nameAr nameEn descriptionAr descriptionEn parent isActive image sizeChart",
    populate: { path: "parent", select: "nameAr nameEn isActive" },
  },
  { path: "colors", select: "nameAr nameEn hex isActive" },
  { path: "sizes", select: "nameAr nameEn sortOrder isActive" },
  { path: "variants.color", select: "nameAr nameEn hex isActive" },
  { path: "variants.size", select: "nameAr nameEn sortOrder isActive" },
];

function idOf(value) {
  if (!value) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function assertObjectId(value, label) {
  const id = textValue(value);
  if (!mongoose.isValidObjectId(id)) throw new ApiError(`${label} غير صالح`);
  return id;
}

function detailText(value) {
  return { ar: value?.ar || "", en: value?.en || "" };
}

function described(product, lang) {
  // Keep description plain. Details/material render separately on the storefront.
  return (lang === "en" ? product.descriptionEn : product.descriptionAr) || "";
}

function keptText(fields, key, fallback = "", max = 2000) {
  if (fields[key] === undefined || fields[key] === null) return fallback;
  return textValue(fields[key]).slice(0, max);
}

function normalizeColorId(value) {
  const text = textValue(value);
  return text || null;
}

function parseKeepImageEntries(fields) {
  if (fields.keepImages === undefined || fields.keepImages === null) return null;
  try {
    const parsed = JSON.parse(String(fields.keepImages || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseNewImageColorIds(fields) {
  try {
    const parsed = JSON.parse(String(fields.newImageColorIds || fields.imageColorIds || "[]"));
    return Array.isArray(parsed) ? parsed.map((id) => normalizeColorId(id)) : [];
  } catch {
    return [];
  }
}

function resolveKeepImages(fields, currentImages, hasIncoming) {
  const current = Array.isArray(currentImages) ? currentImages : [];
  if (!current.length) return [];
  const entries = parseKeepImageEntries(fields);
  if (entries == null) {
    return hasIncoming
      ? []
      : current.map((image) => ({
          url: image.url,
          public_id: image.public_id,
          colorId: normalizeColorId(image.colorId),
        }));
  }
  if (!entries.length) return [];

  const byId = new Map(current.map((image) => [String(image.public_id), image]));
  if (entries.every((entry) => typeof entry === "string" || typeof entry === "number")) {
    return entries
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((image) => ({
        url: image.url,
        public_id: image.public_id,
        colorId: normalizeColorId(image.colorId),
      }));
  }

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const image = byId.get(String(entry.public_id || ""));
      if (!image) return null;
      const hasColorField = Object.prototype.hasOwnProperty.call(entry, "colorId");
      return {
        url: image.url,
        public_id: image.public_id,
        colorId: hasColorField ? normalizeColorId(entry.colorId) : normalizeColorId(image.colorId),
      };
    })
    .filter(Boolean);
}

function serializeImage(image, colorId = undefined) {
  if (!image?.url) return null;
  const linked =
    colorId !== undefined ? normalizeColorId(colorId) : normalizeColorId(image.colorId);
  return {
    url: image.url,
    public_id: image.public_id,
    colorId: linked,
  };
}

function serializeProductImages(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  const colorIds = (product.colors || [])
    .map((color) => (color && typeof color === "object" ? String(color._id) : String(color || "")))
    .filter(Boolean);
  const hasLinked = images.some((image) => normalizeColorId(image?.colorId));
  return images
    .map((image, index) => {
      if (!image?.url) return null;
      const linked = normalizeColorId(image.colorId);
      // Legacy products: image order matched color order 1:1.
      const legacyColor = !hasLinked && colorIds[index] ? colorIds[index] : null;
      return serializeImage(image, linked || legacyColor);
    })
    .filter(Boolean);
}

const MAX_CATEGORY_DEPTH = 4;

function parentRefId(category) {
  if (!category?.parent) return null;
  if (typeof category.parent === "object") {
    return category.parent._id ? String(category.parent._id) : null;
  }
  return String(category.parent);
}

function buildCategoryMap(categories) {
  return new Map((categories || []).map((category) => [String(category._id), category]));
}

function categoryDepth(categoryId, byId) {
  let depth = 0;
  let current = byId.get(String(categoryId));
  const seen = new Set();
  while (current) {
    depth += 1;
    const parentId = parentRefId(current);
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);
    current = byId.get(parentId);
  }
  return depth || 1;
}

function categoryPathNames(categoryId, byId, field = "nameAr") {
  const parts = [];
  let current = byId.get(String(categoryId));
  const seen = new Set();
  while (current) {
    parts.unshift(current[field] || current.nameAr || "");
    const parentId = parentRefId(current);
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);
    current = byId.get(parentId);
  }
  return parts.filter(Boolean).join(" / ");
}

function descendantIds(rootId, byId) {
  const ids = [];
  const queue = [String(rootId)];
  const seen = new Set(queue);
  while (queue.length) {
    const currentId = queue.shift();
    for (const [id, category] of byId) {
      if (parentRefId(category) !== currentId || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      queue.push(id);
    }
  }
  return ids;
}

function subtreeSpan(rootId, byId) {
  const rootDepth = categoryDepth(rootId, byId);
  let deepest = rootDepth;
  for (const id of descendantIds(rootId, byId)) {
    deepest = Math.max(deepest, categoryDepth(id, byId));
  }
  return deepest - rootDepth;
}

async function loadCategoryMap() {
  const categories = await Category.find()
    .select("_id nameAr nameEn parent isActive")
    .lean();
  return buildCategoryMap(categories);
}

function serializeCategory(category, byId = null) {
  if (!category) return null;
  const id = String(category._id);
  const parentDoc =
    category.parent && typeof category.parent === "object" && category.parent.nameAr
      ? category.parent
      : null;
  const hasParent = Boolean(parentRefId(category));
  const map = byId || null;
  const depth = map ? categoryDepth(id, map) : hasParent ? 2 : 1;
  const path = map ? categoryPathNames(id, map, "nameAr") : category.nameAr || "";
  const pathEn = map ? categoryPathNames(id, map, "nameEn") : category.nameEn || "";

  return {
    _id: id,
    name: category.nameAr,
    nameAr: category.nameAr,
    nameEn: category.nameEn,
    description: category.descriptionAr,
    descriptionAr: category.descriptionAr,
    descriptionEn: category.descriptionEn,
    parent: parentDoc
      ? {
          _id: String(parentDoc._id),
          name: parentDoc.nameAr,
          nameAr: parentDoc.nameAr,
          nameEn: parentDoc.nameEn,
          isActive: parentDoc.isActive !== false,
        }
      : category.parent
        ? String(category.parent)
        : null,
    isMain: !hasParent,
    depth,
    path,
    pathEn,
    sortOrder: Number(category.sortOrder) || 0,
    isActive: category.isActive !== false,
    image: serializeImage(category.image),
    sizeChart: hasParent ? serializeImage(category.sizeChart) : null,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

function parseSortOrder(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const raw = Array.isArray(value) ? value[0] : value;
  const order = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(order)) return fallback;
  return Math.max(0, Math.min(99999, order));
}

function byCategoryOrder(a, b) {
  const ao = Number(a.sortOrder) || 0;
  const bo = Number(b.sortOrder) || 0;
  if (ao !== bo) return ao - bo;
  return String(a.path || a.nameAr || "").localeCompare(String(b.path || b.nameAr || ""), "ar");
}

function serializeOption(option) {
  return {
    _id: String(option._id),
    nameAr: option.nameAr,
    nameEn: option.nameEn,
    name: option.nameAr,
    hex: option.hex,
    sortOrder: option.sortOrder ?? 0,
    isActive: option.isActive !== false,
  };
}

function categoryPath(category, byId = null) {
  if (!category) return "";
  if (byId) return categoryPathNames(String(category._id), byId, "nameAr");
  const own = category.nameAr || category.name || "";
  const parentName = category.parent?.nameAr || category.parent?.name;
  return parentName ? `${parentName} / ${own}` : own;
}

function serializeProduct(product, byId = null) {
  const category =
    product.category && typeof product.category === "object" && product.category.nameAr
      ? serializeCategory(product.category, byId)
      : product.category
        ? String(product.category)
        : null;

  const colors = (product.colors || [])
    .filter((color) => color && typeof color === "object" && color.nameAr)
    .map(serializeOption);
  const sizes = (product.sizes || [])
    .filter((size) => size && typeof size === "object" && size.nameAr)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(serializeOption);

  const variants = (product.variants || []).map((variant) => ({
    _id: String(variant._id),
    stock: variant.stock ?? 0,
    size:
      variant.size && typeof variant.size === "object" && variant.size.nameAr
        ? serializeOption(variant.size)
        : variant.size
          ? String(variant.size)
          : null,
    color:
      variant.color && typeof variant.color === "object" && variant.color.nameAr
        ? serializeOption(variant.color)
        : variant.color
          ? String(variant.color)
          : null,
  }));

  return {
    _id: String(product._id),
    name: product.nameAr,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    description: described(product, "ar"),
    descriptionAr: described(product, "ar"),
    descriptionEn: described(product, "en"),
    brandAr: product.brandAr || "",
    brandEn: product.brandEn || "",
    isSet: product.isSet === true,
    price: product.price,
    compareAtPrice: product.compareAtPrice > product.price ? product.compareAtPrice : null,
    discountPercent:
      product.compareAtPrice > product.price
        ? Math.round((1 - product.price / product.compareAtPrice) * 100)
        : 0,
    details: {
      pockets: detailText(product.details?.pockets),
      elastic: detailText(product.details?.elastic),
      neckline: detailText(product.details?.neckline),
      fabric: detailText(product.details?.fabric),
    },
    stock: product.stock ?? 0,
    isActive: product.isActive !== false,
    category,
    categoryPath:
      typeof category === "object"
        ? category.path || categoryPath(product.category, byId)
        : "",
    sizeChart:
      typeof category === "object" && category.parent ? category.sizeChart || null : null,
    images: serializeProductImages(product),
    colors,
    sizes,
    variants,
    soldUnits: Number(product.soldUnits) || 0,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

async function loadSoldUnitsMap() {
  const rows = await Order.aggregate([
    { $match: { status: { $ne: "cancelled" } } },
    { $unwind: "$items" },
    { $match: { "items.product": { $ne: null } } },
    {
      $group: {
        _id: "$items.product",
        units: { $sum: { $ifNull: ["$items.quantity", 0] } },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), Number(row.units) || 0]));
}

async function loadProducts(filter = {}) {
  const [products, byId, soldMap] = await Promise.all([
    Product.find(filter).populate(productPopulate).sort({ createdAt: -1 }),
    loadCategoryMap(),
    loadSoldUnitsMap(),
  ]);
  return products.map((product) => {
    const serialized = serializeProduct(product, byId);
    serialized.soldUnits = soldMap.get(String(product._id)) || 0;
    return serialized;
  });
}

function bilingualNames(fields, arabicLabel, englishLabel, max = 160) {
  const nameAr = requiredText(
    fields.nameAr ?? fields.name,
    arabicLabel,
    max,
  );
  const nameEn = requiredText(fields.nameEn ?? fields.name, englishLabel, max);
  return { nameAr, nameEn };
}

function bilingualDescriptions(fields) {
  const descriptionAr = requiredText(
    fields.descriptionAr ?? fields.description,
    "الوصف العربي",
    4000,
  );
  const descriptionEn = requiredText(
    fields.descriptionEn ?? fields.description,
    "الوصف الإنجليزي",
    4000,
  );
  return { descriptionAr, descriptionEn };
}

function parsePrice(value) {
  const price = Number(textValue(value));
  if (!Number.isFinite(price) || price < 0) throw new ApiError("السعر غير صالح");
  return Math.round(price * 100) / 100;
}

function parseStock(value, label) {
  if (value === undefined || value === null || textValue(value) === "") {
    throw new ApiError(`${label} مطلوبة`);
  }
  const stock = Number(textValue(value));
  if (!Number.isInteger(stock) || stock < 0) {
    throw new ApiError(`${label} يجب أن تكون عدداً صحيحاً يبدأ من صفر`);
  }
  return stock;
}

function parseHex(value) {
  const hex = textValue(value) || "#1e201e";
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new ApiError("كود اللون يجب أن يكون بصيغة #RRGGBB");
  }
  return hex.toLowerCase();
}

function idList(value) {
  const parsed = parseJsonField(value, []);
  if (!Array.isArray(parsed)) throw new ApiError("قائمة الألوان أو المقاسات غير صالحة");
  return [...new Set(parsed.filter(Boolean).map((id) => assertObjectId(id, "المعرف")))];
}

async function resolveParent(parentValue, currentId) {
  const parentText = textValue(parentValue);
  if (!parentText) return null;

  const parentId = assertObjectId(parentText, "القسم الأب");
  if (currentId && parentId === String(currentId)) {
    throw new ApiError("لا يمكن جعل القسم أباً لنفسه");
  }

  const byId = await loadCategoryMap();
  const parent = byId.get(parentId);
  if (!parent) throw new ApiError("القسم الأب غير موجود", 404);

  if (currentId) {
    const forbidden = new Set([String(currentId), ...descendantIds(currentId, byId)]);
    if (forbidden.has(parentId)) {
      throw new ApiError("لا يمكن وضع القسم تحت أحد أقسامه الفرعية");
    }
  }

  const parentDepth = categoryDepth(parentId, byId);
  if (parentDepth >= MAX_CATEGORY_DEPTH) {
    throw new ApiError(`أقصى عمق للأقسام هو ${MAX_CATEGORY_DEPTH} طبقات`);
  }

  const nextDepth = parentDepth + 1;
  if (currentId) {
    const span = subtreeSpan(currentId, byId);
    if (nextDepth + span > MAX_CATEGORY_DEPTH) {
      throw new ApiError(`نقل القسم هنا هيتعدى الحد الأقصى ${MAX_CATEGORY_DEPTH} طبقات`);
    }
  }

  return parent._id || parentId;
}

async function assertUniqueCategory(nameAr, nameEn, parent, excludeId) {
  const existing = await Category.findOne({
    parent: parent || null,
    $or: [{ nameAr }, { nameEn }],
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (existing) {
    throw new ApiError("يوجد قسم بنفس الاسم العربي أو الإنجليزي في هذا المستوى");
  }
}

async function categoryIdsFor(categoryId) {
  const id = assertObjectId(categoryId, "القسم");
  const byId = await loadCategoryMap();
  if (!byId.get(id)) throw new ApiError("القسم غير موجود", 404);
  return [id, ...descendantIds(id, byId)];
}

function buildVariants(fields) {
  const colorIds = idList(fields.colorIds);
  const sizeIds = idList(fields.sizeIds);
  const usesMatrix = colorIds.length > 0 || sizeIds.length > 0;

  if (!usesMatrix) {
    const stock =
      fields.stock === undefined || textValue(fields.stock) === ""
        ? 0
        : parseStock(fields.stock, "كمية المخزون");
    return { colorIds, sizeIds, variants: [], stock };
  }

  const rawVariants = parseJsonField(fields.variants, []);
  if (!Array.isArray(rawVariants)) throw new ApiError("جدول الكميات غير صالح");

  const sizes = sizeIds.length ? sizeIds : [null];
  const colors = colorIds.length ? colorIds : [null];
  const expected = [];

  for (const sizeId of sizes) {
    for (const colorId of colors) {
      const match = rawVariants.find((variant) => {
        const variantSize = variant.sizeId || variant.size || null;
        const variantColor = variant.colorId || variant.color || null;
        return (
          (variantSize ? String(variantSize) : null) === (sizeId || null) &&
          (variantColor ? String(variantColor) : null) === (colorId || null)
        );
      });
      if (!match) {
        throw new ApiError("أدخل كمية كل مقاس مع كل لون قبل الحفظ");
      }
      expected.push({
        size: sizeId,
        color: colorId,
        stock: parseStock(match.stock, "كمية القطعة"),
      });
    }
  }

  if (rawVariants.length !== expected.length) {
    throw new ApiError("جدول الكميات يحتوي خانات زيادة أو نقص");
  }

  return {
    colorIds,
    sizeIds,
    variants: expected,
    stock: expected.reduce((total, variant) => total + variant.stock, 0),
  };
}

async function assertOptionsExist(colorIds, sizeIds) {
  if (colorIds.length) {
    const count = await Color.countDocuments({ _id: { $in: colorIds } });
    if (count !== colorIds.length) throw new ApiError("أحد الألوان المختارة غير موجود");
  }
  if (sizeIds.length) {
    const count = await Size.countDocuments({ _id: { $in: sizeIds } });
    if (count !== sizeIds.length) throw new ApiError("أحد المقاسات المختارة غير موجود");
  }
}

export async function listCategories() {
  const categories = await Category.find()
    .populate("parent", "nameAr nameEn isActive")
    .sort({ sortOrder: 1, createdAt: 1 });
  const byId = buildCategoryMap(categories);
  return categories.map((category) => serializeCategory(category, byId)).sort(byCategoryOrder);
}

export async function addCategory(fields, files) {
  const names = bilingualNames(fields, "اسم القسم بالعربية", "اسم القسم بالإنجليزية");
  const descriptions = bilingualDescriptions(fields);
  const parent = await resolveParent(fields.parent);
  await assertUniqueCategory(names.nameAr, names.nameEn, parent);

  const imageFile = firstFile(files, "image");
  if (!imageFile) throw new ApiError("صورة القسم مطلوبة");

  const image = await uploadImage(imageFile, "dar-alatba/categories");
  let sizeChart = null;
  const sizeChartFile = firstFile(files, "sizeChart");
  if (parent && sizeChartFile) {
    sizeChart = await uploadImage(sizeChartFile, "dar-alatba/size-charts");
  }

  const last = await Category.findOne().sort({ sortOrder: -1 }).select("sortOrder");
  const sortOrder = parseSortOrder(fields.sortOrder, (last?.sortOrder ?? 0) + 1);

  const category = await Category.create({
    ...names,
    ...descriptions,
    parent,
    sortOrder,
    isActive: parseBoolean(fields.isActive, true),
    image,
    sizeChart,
  });
  await category.populate("parent", "nameAr nameEn isActive");
  const byId = await loadCategoryMap();
  return serializeCategory(category, byId);
}

export async function updateCategory(id, fields, files) {
  const categoryId = assertObjectId(id, "القسم");
  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError("القسم غير موجود", 404);

  const names = bilingualNames(fields, "اسم القسم بالعربية", "اسم القسم بالإنجليزية");
  const descriptions = bilingualDescriptions(fields);
  const parent = await resolveParent(fields.parent, categoryId);
  await assertUniqueCategory(names.nameAr, names.nameEn, parent, categoryId);

  const imageFile = firstFile(files, "image");
  let image = category.image;
  if (imageFile) {
    const uploaded = await uploadImage(imageFile, "dar-alatba/categories");
    await deleteImage(category.image?.public_id);
    image = uploaded;
  }
  if (!image?.url) throw new ApiError("صورة القسم مطلوبة");

  let sizeChart = category.sizeChart || null;
  if (!parent) {
    if (sizeChart?.public_id) await deleteImage(sizeChart.public_id);
    sizeChart = null;
  } else {
    const sizeChartFile = firstFile(files, "sizeChart");
    const clearSizeChart = parseBoolean(fields.clearSizeChart, false);
    if (sizeChartFile) {
      const uploaded = await uploadImage(sizeChartFile, "dar-alatba/size-charts");
      await deleteImage(sizeChart?.public_id);
      sizeChart = uploaded;
    } else if (clearSizeChart) {
      await deleteImage(sizeChart?.public_id);
      sizeChart = null;
    }
  }

  const sortOrder = parseSortOrder(fields.sortOrder, category.sortOrder ?? 0);

  category.set({
    ...names,
    ...descriptions,
    parent,
    sortOrder,
    isActive: parseBoolean(fields.isActive, category.isActive),
    image,
    sizeChart,
  });
  await category.save();
  await category.populate("parent", "nameAr nameEn isActive");
  const byId = await loadCategoryMap();
  return serializeCategory(category, byId);
}

export async function removeCategory(id) {
  const categoryId = assertObjectId(id, "القسم");
  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError("القسم غير موجود", 404);

  const byId = await loadCategoryMap();
  const childIds = descendantIds(categoryId, byId);
  const ids = [category._id, ...childIds.map((childId) => childId)];
  const tree = await Category.find({ _id: { $in: ids } });
  const products = await Product.find({ category: { $in: ids } });

  await Promise.all(
    products.flatMap((product) =>
      (product.images || []).map((image) => deleteImage(image.public_id)),
    ),
  );
  await Product.deleteMany({ category: { $in: ids } });
  await Promise.all(
    tree.flatMap((item) => [
      deleteImage(item.image?.public_id),
      deleteImage(item.sizeChart?.public_id),
    ]),
  );
  await Category.deleteMany({ _id: { $in: ids } });
  return { deletedProducts: products.length, deletedCategories: ids.length };
}

export async function listProducts(categoryId) {
  if (!categoryId) return loadProducts();
  const ids = await categoryIdsFor(categoryId);
  return loadProducts({ category: { $in: ids } });
}

export async function getProduct(id) {
  const productId = assertObjectId(id, "المنتج");
  const [product, byId] = await Promise.all([
    Product.findById(productId).populate(productPopulate),
    loadCategoryMap(),
  ]);
  if (!product) throw new ApiError("المنتج غير موجود", 404);
  return serializeProduct(product, byId);
}

async function productPayload(fields, files, current) {
  const names = bilingualNames(fields, "اسم المنتج بالعربية", "اسم المنتج بالإنجليزية");
  const descriptions = bilingualDescriptions(fields);
  const categoryId = assertObjectId(fields.category, "القسم");
  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError("القسم المختار غير موجود", 404);

  const matrix = buildVariants(fields);
  await assertOptionsExist(matrix.colorIds, matrix.sizeIds);

  const incomingImages = fileList(files, "images");
  const currentImages = current?.images || [];
  const keepImages = resolveKeepImages(fields, currentImages, incomingImages.length > 0);
  if (keepImages.length + incomingImages.length === 0) {
    throw new ApiError("يجب رفع صورة واحدة على الأقل للمنتج");
  }

  const newImageColorIds = parseNewImageColorIds(fields);
  const uploaded = [];
  for (let index = 0; index < incomingImages.length; index += 1) {
    const file = incomingImages[index];
    const saved = await uploadImage(file, "dar-alatba/products");
    uploaded.push({
      url: saved.url,
      public_id: saved.public_id,
      colorId: newImageColorIds[index] || null,
    });
  }

  const keepIds = new Set(keepImages.map((image) => String(image.public_id)));
  const removed = currentImages.filter((image) => !keepIds.has(String(image.public_id)));
  await Promise.all(removed.map((image) => deleteImage(image.public_id)));
  const images = [...keepImages, ...uploaded];

  const currentDetails = current?.details || {};
  const details = {
    pockets: {
      ar: keptText(fields, "pocketsAr", currentDetails.pockets?.ar || ""),
      en: keptText(fields, "pocketsEn", currentDetails.pockets?.en || ""),
    },
    elastic: {
      ar: keptText(fields, "elasticAr", currentDetails.elastic?.ar || ""),
      en: keptText(fields, "elasticEn", currentDetails.elastic?.en || ""),
    },
    neckline: {
      ar: keptText(fields, "necklineAr", currentDetails.neckline?.ar || ""),
      en: keptText(fields, "necklineEn", currentDetails.neckline?.en || ""),
    },
    fabric: {
      ar: keptText(fields, "fabricAr", currentDetails.fabric?.ar || ""),
      en: keptText(fields, "fabricEn", currentDetails.fabric?.en || ""),
    },
  };
  const compareRaw = textValue(fields.compareAtPrice);
  const compareAtPrice =
    fields.compareAtPrice === undefined || compareRaw === ""
      ? Number(current?.compareAtPrice) || 0
      : parsePrice(fields.compareAtPrice);

  return {
    ...names,
    ...descriptions,
    brandAr: keptText(fields, "brandAr", current?.brandAr || "", 80),
    brandEn: keptText(fields, "brandEn", current?.brandEn || "", 80),
    isSet:
      fields.isSet === undefined
        ? Boolean(current?.isSet)
        : parseBoolean(fields.isSet, false),
    price: parsePrice(fields.price),
    compareAtPrice,
    details,
    stock: matrix.stock,
    category: category._id,
    isActive: parseBoolean(fields.isActive, true),
    images,
    colors: matrix.colorIds,
    sizes: matrix.sizeIds,
    variants: matrix.variants,
  };
}

export async function addProduct(fields, files) {
  const payload = await productPayload(fields, files);
  const product = await Product.create(payload);
  await product.populate(productPopulate);
  return serializeProduct(product);
}

export async function updateProduct(id, fields, files) {
  const productId = assertObjectId(id, "المنتج");
  const product = await Product.findById(productId);
  if (!product) throw new ApiError("المنتج غير موجود", 404);

  const payload = await productPayload(fields, files, product);
  product.set(payload);
  await product.save();
  await product.populate(productPopulate);
  return serializeProduct(product);
}

export async function removeProduct(id) {
  const productId = assertObjectId(id, "المنتج");
  const product = await Product.findById(productId);
  if (!product) throw new ApiError("المنتج غير موجود", 404);
  await Promise.all((product.images || []).map((image) => deleteImage(image.public_id)));
  await product.deleteOne();
  return { _id: productId };
}

async function assertUniqueOption(Model, nameAr, nameEn, excludeId, label) {
  const existing = await Model.findOne({
    $or: [{ nameAr }, { nameEn }],
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (existing) throw new ApiError(`يوجد ${label} بنفس الاسم العربي أو الإنجليزي`);
}

export async function listColors() {
  const colors = await Color.find().sort({ nameAr: 1 });
  return colors.map(serializeOption);
}

export async function addColor(fields) {
  const names = bilingualNames(fields, "اسم اللون بالعربية", "اسم اللون بالإنجليزية", 60);
  await assertUniqueOption(Color, names.nameAr, names.nameEn, null, "لون");
  const color = await Color.create({
    ...names,
    hex: parseHex(fields.hex),
    isActive: parseBoolean(fields.isActive, true),
  });
  return serializeOption(color);
}

export async function updateColor(id, fields) {
  const colorId = assertObjectId(id, "اللون");
  const color = await Color.findById(colorId);
  if (!color) throw new ApiError("اللون غير موجود", 404);
  const names = bilingualNames(fields, "اسم اللون بالعربية", "اسم اللون بالإنجليزية", 60);
  await assertUniqueOption(Color, names.nameAr, names.nameEn, colorId, "لون");
  color.set({
    ...names,
    hex: parseHex(fields.hex ?? color.hex),
    isActive: parseBoolean(fields.isActive, color.isActive),
  });
  await color.save();
  return serializeOption(color);
}

export async function removeColor(id) {
  const colorId = assertObjectId(id, "اللون");
  const used = await Product.exists({
    $or: [{ colors: colorId }, { "variants.color": colorId }],
  });
  if (used) throw new ApiError("لا يمكن حذف اللون لأنه مستخدم في منتج");
  const color = await Color.findByIdAndDelete(colorId);
  if (!color) throw new ApiError("اللون غير موجود", 404);
  return { _id: colorId };
}

export async function listSizes() {
  const sizes = await Size.find().sort({ sortOrder: 1, nameAr: 1 });
  return sizes.map(serializeOption);
}

export async function addSize(fields) {
  const names = bilingualNames(fields, "اسم المقاس بالعربية", "اسم المقاس بالإنجليزية", 40);
  await assertUniqueOption(Size, names.nameAr, names.nameEn, null, "مقاس");
  const last = await Size.findOne().sort({ sortOrder: -1 }).select("sortOrder");
  const size = await Size.create({
    ...names,
    sortOrder: (last?.sortOrder ?? 0) + 1,
    isActive: parseBoolean(fields.isActive, true),
  });
  return serializeOption(size);
}

export async function updateSize(id, fields) {
  const sizeId = assertObjectId(id, "المقاس");
  const size = await Size.findById(sizeId);
  if (!size) throw new ApiError("المقاس غير موجود", 404);
  const names = bilingualNames(fields, "اسم المقاس بالعربية", "اسم المقاس بالإنجليزية", 40);
  await assertUniqueOption(Size, names.nameAr, names.nameEn, sizeId, "مقاس");
  size.set({
    ...names,
    isActive: parseBoolean(fields.isActive, size.isActive),
  });
  await size.save();
  return serializeOption(size);
}

export async function removeSize(id) {
  const sizeId = assertObjectId(id, "المقاس");
  const used = await Product.exists({
    $or: [{ sizes: sizeId }, { "variants.size": sizeId }],
  });
  if (used) throw new ApiError("لا يمكن حذف المقاس لأنه مستخدم في منتج");
  const size = await Size.findByIdAndDelete(sizeId);
  if (!size) throw new ApiError("المقاس غير موجود", 404);
  return { _id: sizeId };
}

export function variantKey(sizeId, colorId) {
  return `${sizeId || ""}|${colorId || ""}`;
}

export { idOf };
