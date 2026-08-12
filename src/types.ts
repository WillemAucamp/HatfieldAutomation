export interface ColumnMapping {
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
  | "failed"
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
}

export interface BatchRunLog {
  batchId: string;
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  results: ApplicantRunResult[];
}
