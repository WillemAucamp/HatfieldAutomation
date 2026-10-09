import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

export type FieldMode = "copy" | "infer" | "writer" | "join";

export interface FieldMapEntry {
  destination: string;
  source?: string;
  sources?: string[];
  mode: FieldMode;
  notes?: string;
}

export interface IntakeMapping {
  intake: {
    spreadsheet_id: string;
    sheet_name?: string;
    sheet_gid?: number;
    headers_file: string;
  };
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
  required_intake_headers?: string[];
  standing_defaults?: Record<string, string>;
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
  for (const entry of raw.field_map) {
    if (!["copy", "infer", "writer", "join"].includes(entry.mode)) {
      throw new Error(`Invalid field mode "${entry.mode}" for ${entry.destination}`);
    }
  }
  return raw;
}

export function writerColumns(mapping: IntakeMapping): string[] {
  return mapping.field_map.filter((f) => f.mode === "writer").map((f) => f.destination);
}

export function llmColumns(mapping: IntakeMapping): string[] {
  return mapping.field_map.filter((f) => f.mode === "infer").map((f) => f.destination);
}

export function copyColumns(mapping: IntakeMapping): FieldMapEntry[] {
  return mapping.field_map.filter((f) => f.mode === "copy");
}

export function joinColumns(mapping: IntakeMapping): FieldMapEntry[] {
  return mapping.field_map.filter((f) => f.mode === "join");
}

/** Form header strings that must exist on the live intake sheet. */
export function requiredIntakeHeaderLabels(mapping: IntakeMapping): string[] {
  const keys = mapping.required_intake_headers ?? [];
  return keys.map((key) => mapping.intake_headers[key] || key).filter(Boolean);
}
