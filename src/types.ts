export interface ColumnMapping {
  email: string;
  /** Combined "First Last" column; split on the last space when firstName/surname are omitted. */
  fullName?: string;
  firstName?: string;
  surname?: string;
  idNumber: string;
  mobile: string;
  addressLine1: string;
  postalCode: string;
  residencyStartDate: string;
  nextOfKinFullName?: string;
  nextOfKinName?: string;
  nextOfKinSurname?: string;
  nextOfKinPhone?: string;
  employerName: string;
  employerPhone: string;
  employerAddress: string;
  employerPostalCode: string;
  employmentStartDate: string;
  grossMonthly: string;
  nettSalary: string;
  telephoneExpense: string;
  transportExpense: string;
  foodExpense: string;
  accountHolder: string;
  referenceNumber?: string;
  timing?: string;
}

export interface ApplicantRecord {
  rowIndex: number;
  rowId: string;
  email: string;
  firstName: string;
  surname: string;
  idNumber: string;
  mobile: string;
  addressLine1: string;
  postalCode: string;
  residencyStartDate: string;
  nextOfKinName: string;
  nextOfKinSurname: string;
  nextOfKinPhone?: string;
  employerName: string;
  employerPhone: string;
  employerAddress: string;
  employerPostalCode: string;
  employmentStartDate: string;
  grossMonthly: string;
  nettSalary: string;
  telephoneExpense: string;
  transportExpense: string;
  foodExpense: string;
  accountHolder: string;
  processed?: string;
  existingReference?: string;
  errors: DataError[];
}

export interface DataError {
  code: string;
  field: string;
  message: string;
  value: string;
}

export interface AppConfig {
  sheetCsvUrl: string;
  mappingPath: string;
  dryRun: boolean;
  strictMode: boolean;
  headless: boolean;
  rowFilter: number[];
  actionDelayMin: number;
  actionDelayMax: number;
  financeUrl: string;
  skipProcessed: boolean;
  keepLastOpen: boolean;
  sheetId: string;
  sheetWebhookUrl: string;
  googleServiceAccountFile: string;
}

export type FieldStrategy =
  | "label"
  | "role"
  | "placeholder"
  | "fieldset"
  | "fuzzy"
  | "semantic";

export interface FieldLookupResult {
  found: boolean;
  strategy?: FieldStrategy;
  locatorDescription?: string;
}

export interface FieldWarning {
  field: string;
  section: string;
  message: string;
  screenshotPath?: string;
}

export type RunStatus =
  | "stopped-at-uploads"
  | "submitted"
  | "already-submitted"
  | "failed"
  | "data-error"
  | "manual-review-needed"
  | "dry-run-complete";

export interface ApplicantRunResult {
  rowIndex: number;
  rowId: string;
  applicantName: string;
  status: RunStatus;
  sectionReached: number;
  warnings: FieldWarning[];
  screenshotDir: string;
  startedAt: string;
  finishedAt: string;
  error?: string;
  errorCodes?: string[];
  referenceNumber?: string;
  sheetStatus?: string;
  durationSeconds?: number;
  writtenToSheet?: boolean;
}

export interface BatchRunLog {
  batchId: string;
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  results: ApplicantRunResult[];
}
