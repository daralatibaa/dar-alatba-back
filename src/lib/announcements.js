import mongoose from "mongoose";
import { cached, invalidate } from "./cache";
import { ApiError } from "./http";
import { Announcement } from "./models";

function bustAnnouncementCache() {
  invalidate("announcements:all", "announcements:active", "store:settings");
}

function exactText(value, label) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  if (text.length === 0) throw new ApiError(`${label} مطلوب`);
  if (text.length > 800) throw new ApiError(`${label} طويل جداً`);
  return text;
}

function textsFrom(fields, current) {
  const textAr = exactText(
    fields.textAr !== undefined ? fields.textAr : fields.text !== undefined ? fields.text : current?.textAr || current?.text,
    "النص العربي",
  );
  const textEn = exactText(
    fields.textEn !== undefined ? fields.textEn : current?.textEn,
    "النص الإنجليزي",
  );
  return { text: textAr, textAr, textEn };
}

function parseActive(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() !== "false";
}

function serialize(item) {
  const textAr = item.textAr || item.text || "";
  return {
    _id: String(item._id),
    text: textAr,
    textAr,
    textEn: item.textEn || "",
    isActive: item.isActive !== false,
    sortOrder: item.sortOrder ?? 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function listAnnouncements(activeOnly = false) {
  const key = activeOnly ? "announcements:active" : "announcements:all";
  return cached(key, 60 * 1000, async () => {
    const filter = activeOnly ? { isActive: true } : {};
    const items = await Announcement.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean();
    return items.map(serialize);
  });
}

export async function addAnnouncement(fields) {
  const texts = textsFrom(fields);
  const last = await Announcement.findOne().sort({ sortOrder: -1 }).select("sortOrder");
  const item = await Announcement.create({
    ...texts,
    isActive: parseActive(fields.isActive, true),
    sortOrder: (last?.sortOrder ?? 0) + 1,
  });
  bustAnnouncementCache();
  return serialize(item);
}

function assertId(id) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError("العبارة غير موجودة", 404);
  return id;
}

export async function updateAnnouncement(id, fields) {
  assertId(id);
  const item = await Announcement.findById(id);
  if (!item) throw new ApiError("العبارة غير موجودة", 404);

  const next = {
    ...textsFrom(fields, item),
    isActive: parseActive(fields.isActive, item.isActive),
  };
  if (fields.sortOrder !== undefined && fields.sortOrder !== "") {
    const order = Number(fields.sortOrder);
    if (!Number.isInteger(order)) throw new ApiError("ترتيب العبارة غير صالح");
    next.sortOrder = order;
  }

  item.set(next);
  await item.save();
  bustAnnouncementCache();
  return serialize(item);
}

export async function removeAnnouncement(id) {
  assertId(id);
  const item = await Announcement.findByIdAndDelete(id);
  if (!item) throw new ApiError("العبارة غير موجودة", 404);
  bustAnnouncementCache();
  return { _id: String(id) };
}
