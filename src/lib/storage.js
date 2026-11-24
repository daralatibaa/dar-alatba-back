import { del, put } from "@vercel/blob";
import { v2 as cloudinary } from "cloudinary";
import { ApiError } from "./http";

const MAX_UPLOAD_BYTES = 1.2 * 1024 * 1024;

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
    throw new ApiError("حجم الصورة كبير. اضغط الصورة قبل الرفع (حد أقصى حوالي 1.2 ميجا).");
  }
}

function safeFileName(file, folder) {
  const raw = String(file.name || "image.jpg")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const name = raw || "image.jpg";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${folder}/${stamp}-${name}`;
}

async function uploadToBlob(file, folder) {
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const blob = await put(safeFileName(file, folder), buffer, {
      access: "public",
      contentType: file.type || "image/jpeg",
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
  const buffer = Buffer.from(await file.arrayBuffer());
  let uploaded;
  try {
    uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          // Store a lighter derivative to protect free-tier quota.
          transformation: [{ width: 1600, crop: "limit", quality: "auto:eco", fetch_format: "auto" }],
        },
        (error, result) => {
          if (error || !result) reject(error || new Error("Upload failed"));
          else resolve(result);
        },
      );
      stream.end(buffer);
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
