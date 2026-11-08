import type { PageSummary } from "@/lib/domain/ops/helpers";
import type { DatabaseView, PageRow, PropertyDef, SettingsRow } from "@/lib/domain/types";

export type { PageSummary, PageRow, PropertyDef, DatabaseView, SettingsRow };

export interface PageGetResult {
  page: PageRow;
  breadcrumbs: { _id: string; title: string; icon: string | null; kind: string }[];
  children: PageSummary[];
  database: PageSummary | null;
  inTrash: boolean;
  trashedWith: PageSummary | null;
}

export interface DocumentGetResult {
  pageId: string;
  title: string;
  revision: number;
  updatedAt: number;
  wordCount: number;
  readOnly: boolean;
  blocks: unknown[];
}

export interface RecordView extends PageSummary {
  values: Record<string, string | number | boolean | string[] | null>;
}
