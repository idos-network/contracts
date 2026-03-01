import "dotenv/config";
import { clearDelegation, ensureDelegation } from "./batch.js";
import { type DisbursementRow, loadDisbursementCsv } from "./csv.js";
import { findPendingRows } from "./findPendingRows.js";
import { sumOf } from "./lib.js";
import { EVMModality } from "./modalities.js";
import {
  disburseAll,
  ensureAllowance,
  fetchDisbursementLogs,
  setupTdeEnvironment,
} from "./tdeSetup.js";

const {
  tdeTimestamp,
  nowTimestamp,
  account,
  publicClient,
  batchConfig,
  tokenContract,
  tdeDisbursementAddress,
  tdeDisbursementDeploymentBlock,
} = await setupTdeEnvironment();

const filterCurrentlyDisbursableRows =
  nowTimestamp < tdeTimestamp
    ? (rows: DisbursementRow[]) => rows.filter((r) => r.modality !== EVMModality.DIRECT)
    : (rows: DisbursementRow[]) => rows;

const allRows = loadDisbursementCsv("disbursement.csv");
const logs = await fetchDisbursementLogs(
  publicClient,
  tdeDisbursementAddress,
  tdeDisbursementDeploymentBlock,
);
const pendingRows = findPendingRows(allRows, logs);
const disbursableRows = filterCurrentlyDisbursableRows(pendingRows);
const alreadyDisbursed = allRows.length - pendingRows.length;
const skipped = pendingRows.length - disbursableRows.length;

console.error(`${alreadyDisbursed} already disbursed`);
if (skipped > 0) console.error(`${skipped} skipped (DIRECT, before TDE)`);

if (disbursableRows.length === 0) {
  console.error("Nothing to do.");
} else {
  console.error(`Disbursing ${disbursableRows.length}...`);

  await ensureAllowance(
    tokenContract,
    account.address,
    publicClient,
    tdeDisbursementAddress,
    sumOf(disbursableRows.map((r) => r.amount)),
  );
  await ensureDelegation(batchConfig);
  await disburseAll(batchConfig, tdeDisbursementAddress, disbursableRows);
  await clearDelegation(batchConfig);
}
