import { listAnnouncements } from "@/lib/announcements";
import { publicOk } from "@/lib/http";
import { handle } from "@/lib/route";

export const runtime = "nodejs";

export const GET = handle(async () =>
  publicOk(await listAnnouncements(true), "تم جلب العبارات", 60),
);
