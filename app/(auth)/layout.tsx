import type { ReactNode } from "react";
import { AppRoot } from "@/components/AppRoot";

export default function Layout({ children }: { children: ReactNode }) {
  return <AppRoot>{children}</AppRoot>;
}
