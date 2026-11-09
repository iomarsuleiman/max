"use client";

import dynamic from "next/dynamic";
import { Topbar } from "@/components/workspace/Topbar";

const GraphView = dynamic(() => import("@/components/graph/GraphView").then((m) => m.GraphView), { ssr: false });

export default function GraphPage() {
  return (
    <>
      <Topbar crumbs={[{ href: "/graph", title: "Graph view" }]} />
      <h1 className="sr-only">Graph view</h1>
      <GraphView />
    </>
  );
}
