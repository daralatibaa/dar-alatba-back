import { v2 as cloudinary } from "cloudinary";
import { ApiError } from "./http";

let configured = false;

function configureCloudinary() {
  if (configured) return;
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
  configured = true;
}

export async function uploadImage(file, folder) {
  if (!file || typeof file === "string" || file.size === 0) {
    throw new ApiError("الصورة غير صالحة");
  }
  if (file.type && !file.type.startsWith("image/")) {
    throw new ApiError("الملف يجب أن يكون صورة");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new ApiError("حجم الصورة يجب ألا يتجاوز 8 ميجابايت");
  }

  configureCloudinary();
  const buffer = Buffer.from(await file.arrayBuffer());

  let uploaded;
  try {
    uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: "image" },
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
        "حساب Cloudinary معطّل. فعّله من لوحة Cloudinary أو حدّث CLOUDINARY_* في Vercel.",
        503,
      );
    }
    throw new ApiError(
      detail ? `فشل رفع الصورة: ${detail}` : "فشل رفع الصورة",
      502,
    );
  }

  return { url: uploaded.secure_url, public_id: uploaded.public_id };
}

export async function deleteImage(publicId) {
  if (!publicId) return;
  try {
    configureCloudinary();
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Cloudinary delete failed", error);
  }
}
