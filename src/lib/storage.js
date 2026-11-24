import { del, put } from "@vercel/blob";
import { v2 as cloudinary } from "cloudinary";
import sharp from "sharp";
import { ApiError } from "./http";

/** Incoming request hard cap before server-side recompress. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Stored asset target after sharp. */
const STORE_MAX_BYTES = 180 * 1024;
const STORE_MAX_EDGE = 1100;

let cloudinaryConfigured = false;

function configureCloudinary() {
  if (cloudinaryConfigured) return;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new ApiError("إعدادات رفع الصور غير مكتملة", 500);
  }
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
  cloudinaryConfigured = true;
}

function useBlob() {
  return Boolean(String(process.env.BLOB_READ_WRITE_TOKEN || "").trim());
}

function assertImageFile(file) {
  if (!file || typeof file === "string" || file.size === 0) {
    throw new ApiError("الصورة غير صالحة");
  }
  if (file.type && !file.type.startsWith("image/")) {
    throw new ApiError("الملف يجب أن يكون صورة");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError("حجم الصورة كبير قبل الضغط. اختَر صورة أصغر.");
  }
}

function safeBaseName(file) {
  return (
    String(file.name || "image")
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "image"
  );
}

function safeFileName(file, folder, ext = "webp") {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${folder}/${stamp}-${safeBaseName(file)}.${ext}`;
}

/** Re-encode every upload to a small WebP before storage. */
async function optimizeForStore(file) {
  const input = Buffer.from(await file.arrayBuffer());
  let quality = 58;
  let edge = STORE_MAX_EDGE;
  let output = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    output = await sharp(input, { failOn: "none" })
      .rotate()
      .resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality, effort: 4, smartSubsample: true })
      .toBuffer();
    if (output.length <= STORE_MAX_BYTES) break;
    if (quality > 38) {
      quality -= 5;
      continue;
    }
    edge = Math.max(640, Math.round(edge * 0.82));
    quality = 48;
  }

  if (!output?.length) throw new ApiError("تعذر ضغط الصورة على السيرفر");
  if (output.length > STORE_MAX_BYTES * 1.35) {
    throw new ApiError("الصورة ما زالت كبيرة بعد الضغط. استخدم صورة أبسط.");
  }

  return {
    buffer: output,
    contentType: "image/webp",
    pathname: (folder) => safeFileName(file, folder, "webp"),
  };
}

async function uploadToBlob(file, folder) {
  const optimized = await optimizeForStore(file);
  try {
    const blob = await put(optimized.pathname(folder), optimized.buffer, {
      access: "public",
      contentType: optimized.contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
    });
    return { url: blob.url, public_id: blob.url };
  } catch (error) {
    const detail = String(error?.message || error || "");
    if (/private store/i.test(detail)) {
      throw new ApiError(
        "مخزن Blob مضبوط Private. احذف المتجر وأنشئ Blob جديد بوصول Public عشان صور المتجر تتفتح للزوّار.",
        503,
      );
    }
    throw new ApiError(detail ? `فشل رفع Blob: ${detail}` : "فشل رفع الصورة على Blob", 502);
  }
}

async function uploadToCloudinary(file, folder) {
  configureCloudinary();
  const optimized = await optimizeForStore(file);
  let uploaded;
  try {
    uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          format: "webp",
          transformation: [{ width: STORE_MAX_EDGE, crop: "limit", quality: "auto:eco" }],
        },
        (error, result) => {
          if (error || !result) reject(error || new Error("Upload failed"));
          else resolve(result);
        },
      );
      stream.end(optimized.buffer);
    });
  } catch (error) {
    const detail = String(error?.message || error || "").trim();
    if (/disabled/i.test(detail)) {
      throw new ApiError(
        "حساب Cloudinary معطّل. أضف BLOB_READ_WRITE_TOKEN من Vercel (دار الأطباء) للرفع على Blob بدلًا منه.",
        503,
      );
    }
    throw new ApiError(detail ? `فشل رفع الصورة: ${detail}` : "فشل رفع الصورة", 502);
  }
  return { url: uploaded.secure_url, public_id: uploaded.public_id };
}

/** Upload image to Vercel Blob when configured, otherwise Cloudinary. */
export async function uploadImage(file, folder = "dar-alatba") {
  assertImageFile(file);
  if (useBlob()) return uploadToBlob(file, folder);
  return uploadToCloudinary(file, folder);
}

export async function deleteImage(publicId) {
  if (!publicId) return;
  const id = String(publicId);
  try {
    if (id.includes("blob.vercel-storage.com") || id.startsWith("http")) {
      if (!useBlob()) return;
      await del(id, { token: process.env.BLOB_READ_WRITE_TOKEN });
      return;
    }
    configureCloudinary();
    await cloudinary.uploader.destroy(id);
  } catch (error) {
    console.error("Image delete failed", error);
  }
}
