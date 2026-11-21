import { Suspense } from "react";
import { OrgSettings } from "@/components/org/OrgSettings";

export const metadata = { title: "Organization" };

export default function Organization() {
  return (
    <Suspense>
      <OrgSettings />
    </Suspense>
  );
}
