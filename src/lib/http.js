export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function ok(data, message = "تم بنجاح", status = 200, headers = undefined) {
  return Response.json({ success: true, message, data }, { status, headers });
}

/** CDN-friendly response for public catalog/settings reads. */
export function publicOk(data, message = "تم بنجاح", maxAge = 60) {
  return ok(data, message, 200, {
    "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${Math.max(maxAge * 5, 300)}`,
  });
}

export function fail(error) {
  if (error?.name === "ApiError") {
    return Response.json(
      { success: false, message: error.message },
      { status: error.status || 400 },
    );
  }

  if (error?.code === 11000) {
    return Response.json(
      { success: false, message: "هذه البيانات موجودة مسبقاً" },
      { status: 409 },
    );
  }

  console.error(error);
  return Response.json(
    { success: false, message: "حدث خطأ في الخادم، حاول مرة أخرى" },
    { status: 500 },
  );
}
