import { loadColumnMapping, loadConfig } from "./config.js";
import { fetchSheetData, validateApplicant } from "./fetchSheetData.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const mapping = loadColumnMapping(config.mappingPath);

  console.log(`Sheet: ${config.sheetCsvUrl}`);
  const applicants = await fetchSheetData({
    csvUrl: config.sheetCsvUrl,
    mapping,
    rowFilter: config.rowFilter.length > 0 ? config.rowFilter : undefined,
  });

  if (applicants.length === 0) {
    console.log("No unprocessed applicants found.");
    return;
  }

  for (const applicant of applicants) {
    const issues = validateApplicant(applicant);
    console.log("\n---");
    console.log(
      JSON.stringify(
        {
          rowIndex: applicant.rowIndex,
          rowId: applicant.rowId,
          email: applicant.email,
          firstName: applicant.firstName,
          surname: applicant.surname,
          idNumber: applicant.idNumber,
          mobile: applicant.mobile,
          addressLine1: applicant.addressLine1,
          postalCode: applicant.postalCode,
          residencyStartDate: applicant.residencyStartDate,
          nextOfKinName: applicant.nextOfKinName,
          nextOfKinSurname: applicant.nextOfKinSurname,
          nextOfKinPhone: applicant.nextOfKinPhone,
          employerName: applicant.employerName,
          employerPhone: applicant.employerPhone,
          employerAddress: applicant.employerAddress,
          employerPostalCode: applicant.employerPostalCode,
          employmentStartDate: applicant.employmentStartDate,
          grossMonthly: applicant.grossMonthly,
          nettSalary: applicant.nettSalary,
          telephoneExpense: applicant.telephoneExpense,
          transportExpense: applicant.transportExpense,
          foodExpense: applicant.foodExpense,
          accountHolder: applicant.accountHolder,
          validationIssues: issues,
        },
        null,
        2
      )
    );
  }

  console.log(`\n${applicants.length} applicant(s) ready to process.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
