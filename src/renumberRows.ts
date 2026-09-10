import { pathToFileURL } from "node:url";
import { loadConfig, loadColumnMapping } from "./config.js";
import { renumberSheetRows } from "./sheetWriter.js";

export async function renumberRowsMain(): Promise<void> {
  const config = loadConfig();
  const mapping = loadColumnMapping(config.mappingPath);
  const result = await renumberSheetRows(config, mapping);
  if (!result.ok) {
    console.error(`Renumber failed: ${result.error ?? "unknown error"}`);
    process.exit(1);
  }
  console.log(
    result.count != null
      ? `NR column updated: ${result.count} data row(s) numbered (1 on row 2).`
      : "NR column updated."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  renumberRowsMain().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
