import { Suspense } from "react";
import { StartResolver } from "@/components/workspace/StartResolver";

export const metadata = { title: "Max" };

export default function HomePage() {
  return (
    <Suspense>
      <StartResolver />
    </Suspense>
  );
}
