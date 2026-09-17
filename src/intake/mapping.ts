import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

export type FieldMode = "copy" | "infer" | "writer";

export interface FieldMapEntry {
  destination: string;
  source?: string;
  sources?: string[];
  mode: FieldMode;
  notes?: string;
}

export interface IntakeMapping {
  intake: { spreadsheet_id: string; headers_file: string };
  destination: {
    spreadsheet_id: string;
    spreadsheet_url?: string;
    gid?: number;
    headers_file: string;
    loaded_clients_spreadsheet_id?: string;
    column_count: number;
  };
  intake_columns: string[];
  intake_headers: Record<string, string>;
  destination_columns: string[];
  field_map: FieldMapEntry[];
  passthrough_not_on_destination?: string[];
  rules?: string[];
}

export function loadIntakeMapping(mappingPath: string): IntakeMapping {
  const absolute = resolve(mappingPath);
  const raw = parse(readFileSync(absolute, "utf-8")) as IntakeMapping;
  if (!raw?.destination_columns?.length || !raw?.field_map?.length) {
    throw new Error(`Invalid intake mapping at ${absolute}`);
  }
  return raw;
}

export function writerColumns(mapping: IntakeMapping): string[] {
  return mapping.field_map.filter((f) => f.mode === "writer").map((f) => f.destination);
}

export function llmColumns(mapping: IntakeMapping): string[] {
  return mapping.field_map.filter((f) => f.mode !== "writer").map((f) => f.destination);
}
