import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    public_id: { type: String, required: true },
    colorId: { type: String, default: null },
  },
  { _id: false },
);

const categorySchema = new mongoose.Schema(
  {
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    descriptionAr: { type: String, required: true, trim: true },
    descriptionEn: { type: String, required: true, trim: true },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    image: { type: imageSchema, default: null },
    sizeChart: { type: imageSchema, default: null },
  },
  { timestamps: true },
);

if (
  mongoose.models.Category &&
  (!mongoose.models.Category.schema.path("sizeChart") ||
    !mongoose.models.Category.schema.path("sortOrder"))
) {
  mongoose.deleteModel("Category");
}

const colorSchema = new mongoose.Schema(
  {
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    hex: { type: String, required: true, default: "#1e201e" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const announcementSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    textAr: { type: String, default: "" },
    textEn: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const sizeSchema = new mongoose.Schema(
  {
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const variantSchema = new mongoose.Schema(
  {
    size: { type: mongoose.Schema.Types.ObjectId, ref: "Size", default: null },
    color: { type: mongoose.Schema.Types.ObjectId, ref: "Color", default: null },
    stock: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

const detailTextSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    en: { type: String, default: "" },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    descriptionAr: { type: String, required: true, trim: true },
    descriptionEn: { type: String, required: true, trim: true },
    brandAr: { type: String, default: "" },
    brandEn: { type: String, default: "" },
    isSet: { type: Boolean, default: false },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, default: 0, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    details: {
      pockets: { type: detailTextSchema, default: () => ({}) },
      elastic: { type: detailTextSchema, default: () => ({}) },
      neckline: { type: detailTextSchema, default: () => ({}) },
      fabric: { type: detailTextSchema, default: () => ({}) },
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    isActive: { type: Boolean, default: true },
    images: { type: [imageSchema], default: [] },
    colors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Color" }],
    sizes: [{ type: mongoose.Schema.Types.ObjectId, ref: "Size" }],
    variants: { type: [variantSchema], default: [] },
  },
  { timestamps: true },
);

categorySchema.index({ parent: 1, nameAr: 1 });
productSchema.index({ category: 1, createdAt: -1 });

export const Category =
  mongoose.models.Category || mongoose.model("Category", categorySchema);
export const Color =
  mongoose.models.Color || mongoose.model("Color", colorSchema);
export const Size = mongoose.models.Size || mongoose.model("Size", sizeSchema);
if (mongoose.models.Announcement && !mongoose.models.Announcement.schema.path("textEn")) {
  mongoose.deleteModel("Announcement");
}
export const Announcement =
  mongoose.models.Announcement ||
  mongoose.model("Announcement", announcementSchema);

const policySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      enum: ["privacy", "returns", "about", "terms"],
    },
    titleAr: { type: String, required: true, default: "" },
    titleEn: { type: String, required: true, default: "" },
    contentAr: { type: String, required: true, default: "" },
    contentEn: { type: String, required: true, default: "" },
  },
  { timestamps: true },
);

if (mongoose.models.Policy) {
  const keyPath = mongoose.models.Policy.schema.path("key");
  const allowed = keyPath?.enumValues || keyPath?.options?.enum || [];
  if (!allowed.includes("about") || !allowed.includes("terms")) {
    mongoose.deleteModel("Policy");
  }
}
export const Policy =
  mongoose.models.Policy || mongoose.model("Policy", policySchema);

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    name: { type: String, default: "" },
    price: { type: Number, default: 0 },
    quantity: { type: Number, required: true, min: 1 },
    image: { type: String, default: "" },
    sizeId: { type: String, default: "" },
    colorId: { type: String, default: "" },
    sizeName: { type: String, default: "" },
    colorName: { type: String, default: "" },
    pantsSizeId: { type: String, default: "" },
    pantsSizeName: { type: String, default: "" },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    governorate: { type: String, required: true },
    detailedAddress: { type: String, required: true },
    transferPhone: { type: String, default: "" },
    paymentMethod: { type: String, enum: ["", "cod", "instapay", "vodafone"], default: "" },
    notes: { type: String, default: "" },
    items: { type: [orderItemSchema], default: [] },
    productsTotal: { type: Number, default: 0, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    embroideryNote: { type: String, default: "" },
    embroideryPrice: { type: Number, default: 0, min: 0 },
    payableTotal: { type: Number, default: 0, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    stockRestored: { type: Boolean, default: false },
    transferImage: { type: imageSchema, default: null },
    status: { type: String, enum: ["pending", "received", "cancelled", "completed"], default: "pending" },
    completedAt: { type: Date, default: null },
    whatsapp: {
      status: { type: String, default: "" },
      messageId: { type: String, default: "" },
      error: { type: String, default: "" },
      sentAt: { type: Date, default: null },
      reply: { type: String, default: "" },
      repliedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

const beonEventSchema = new mongoose.Schema(
  {
    event: { type: String, default: "" },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    matchedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    reply: { type: String, default: "" },
  },
  { timestamps: true },
);

orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ customerPhone: 1, createdAt: -1 });

if (mongoose.models.Product) {
  const imageColor = mongoose.models.Product.schema.path("images")?.schema?.path("colorId");
  if (!mongoose.models.Product.schema.path("brandAr") || !imageColor) {
    mongoose.deleteModel("Product");
  }
}
export const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);
if (
  mongoose.models.Order &&
  (!mongoose.models.Order.schema.path("paymentMethod") ||
    !mongoose.models.Order.schema.path("stockRestored") ||
    !mongoose.models.Order.schema.path("status").enumValues.includes("cancelled"))
) {
  mongoose.deleteModel("Order");
}
export const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
export const BeonEvent =
  mongoose.models.BeonEvent || mongoose.model("BeonEvent", beonEventSchema);

const cartItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    productId: { type: String, default: "" },
    name: { type: String, default: "" },
    image: { type: String, default: "" },
    price: { type: Number, default: 0 },
    qty: { type: Number, default: 1, min: 1 },
    sizeId: { type: String, default: null },
    colorId: { type: String, default: null },
    pantsSizeId: { type: String, default: null },
    topSizeName: { type: String, default: "" },
    pantsSizeName: { type: String, default: "" },
    sizeName: { type: String, default: "" },
    colorName: { type: String, default: "" },
    maxStock: { type: Number, default: null },
  },
  { _id: false },
);

const customerSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    passwordHash: { type: String, required: true },
    favorites: { type: [String], default: [] },
    cart: { type: [cartItemSchema], default: [] },
    sessionTokenHash: { type: String, default: null, index: true },
    resetCodeHash: { type: String, default: null },
    resetExpires: { type: Date, default: null },
  },
  { timestamps: true },
);

if (mongoose.models.Customer && !mongoose.models.Customer.schema.path("cart")) {
  mongoose.deleteModel("Customer");
}
export const Customer =
  mongoose.models.Customer || mongoose.model("Customer", customerSchema);

const storeSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "store" },
    shopPageSize: { type: Number, default: 12, min: 3, max: 48 },
  },
  { timestamps: true },
);

export const StoreSettings =
  mongoose.models.StoreSettings || mongoose.model("StoreSettings", storeSettingsSchema);
