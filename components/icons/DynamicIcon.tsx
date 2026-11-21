"use client";
import { DynamicIcon as LucideDynamicIcon } from "lucide-react/dynamic";
import type { ComponentProps } from "react";
import { ARDIA_BY_NAME } from "./index";

/** Stored Lucide names stay compatible; matching choices use the same artwork as UI controls. */
export function DynamicIcon({ name, ...props }: ComponentProps<typeof LucideDynamicIcon>) {
  const Icon = ARDIA_BY_NAME[name];
  return Icon ? <Icon {...props} /> : <LucideDynamicIcon name={name} {...props} />;
}
