import { redirect } from "next/navigation";
import { CLOUD } from "@/lib/config";
import { LandingContent } from "@/components/marketing/Landing";
export default async function Landing() {
  if (!CLOUD) redirect("/home");
  const { auth } = await import("@clerk/nextjs/server");
  if ((await auth()).userId) redirect("/home");
  return <LandingContent />;
}
