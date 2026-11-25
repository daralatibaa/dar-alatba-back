import { redirect } from "next/navigation";

/** API host only — keep storefront traffic on www.daralatba.com to save Fluid CPU. */
export default function Home() {
  redirect("https://www.daralatba.com");
}
