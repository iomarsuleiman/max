import { Suspense } from "react";
import { AppConsent } from "@/components/apps/Consent";

export const metadata = { title: "Connect an app" };

export default async function ConnectApp({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <AppConsent appId={id} />
    </Suspense>
  );
}
