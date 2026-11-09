import { Suspense } from "react";
import { HomeResolver } from "@/components/home/HomeResolver";

export const metadata = { title: "Home" };

export default function HomePage() {
  return (
    <Suspense>
      <HomeResolver />
    </Suspense>
  );
}
