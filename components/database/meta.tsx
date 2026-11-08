"use client";

import {
  AlignLeft,
  AtSign,
  Calculator,
  Calendar,
  CheckSquare,
  CircleDot,
  Clock,
  Hash,
  Link,
  List,
  ListChecks,
  Phone,
  Sigma,
  Tags,
  Text,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import type { OptionColor, PropertyDef, PropertyType } from "@/lib/domain/types";

export const TYPE_META: Record<PropertyType, { label: string; icon: LucideIcon; help: string }> = {
  title: { label: "Name", icon: Text, help: "The row's title" },
  text: { label: "Text", icon: AlignLeft, help: "Plain text" },
  number: { label: "Number", icon: Hash, help: "Numbers, percentages or money" },
  select: { label: "Select", icon: CircleDot, help: "One option from a list" },
  multi_select: { label: "Multi-select", icon: Tags, help: "Several options from a list" },
  status: { label: "Status", icon: ListChecks, help: "Progress such as To do, Doing, Done" },
  checkbox: { label: "Checkbox", icon: CheckSquare, help: "Yes or no" },
  date: { label: "Date", icon: Calendar, help: "A day, optionally with a time" },
  url: { label: "URL", icon: Link, help: "A web address" },
  email: { label: "Email", icon: AtSign, help: "An email address" },
  phone: { label: "Phone", icon: Phone, help: "A phone number" },
  relation: { label: "Relation", icon: ArrowUpRight, help: "Links to rows in another database" },
  formula: { label: "Formula", icon: Sigma, help: "Calculated from other properties" },
  rollup: { label: "Rollup", icon: Calculator, help: "Summarizes related rows" },
  created_time: { label: "Created time", icon: Clock, help: "When the row was created" },
  updated_time: { label: "Last edited time", icon: Clock, help: "When the row last changed" },
};

export const ADDABLE_TYPES: PropertyType[] = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "relation", "formula", "rollup", "created_time", "updated_time"];
export const COLORS: OptionColor[] = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
export const READONLY_TYPES = new Set<PropertyType>(["formula", "rollup", "created_time", "updated_time"]);

export function PropIcon({ type, className = "size-3.5" }: { type: PropertyType; className?: string }) {
  const Icon = TYPE_META[type]?.icon ?? List;
  return <Icon className={className} aria-hidden strokeWidth={1.75} />;
}

export function Tag({ name, color }: { name: string; color: OptionColor }) {
  return (
    <span className="tag" data-color={color}>
      {name}
    </span>
  );
}

export function formatNumber(n: number, prop: PropertyDef): string {
  if (prop.numberFormat === "percent") return `${(n * (Math.abs(n) <= 1 ? 100 : 1)).toLocaleString("en", { maximumFractionDigits: 2 })}%`;
  if (prop.numberFormat === "currency") return n.toLocaleString("en", { style: "currency", currency: "USD" });
  return n.toLocaleString("en", { maximumFractionDigits: 6 });
}

export function formatDateValue(v: string): string {
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return v;
  return v.length > 10 ? d.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : d.toLocaleDateString("en", { dateStyle: "medium" });
}
