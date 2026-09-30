import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { readMysqlConfig } from "../src/mysqlConfig.js";
import { initializeMysqlSession } from "../src/mysqlDatabase.js";
import { loadSqliteExport } from "../src/sqliteExportReader.js";
import { importMysqlData } from "../src/mysqlDataImport.js";

export const REHEARSAL_SOURCE_SHA256 = "9e01e2f4d5b0e05cb0dac415ccffa4179e42105a76efc42df7e3788c9e46933d";

function safeCode(error, fallback) {
  return typeof error?.code === "string" && /^(?:(?:IMPORT|DATA_IMPORT|SQLITE_EXPORT|SCHEMA|ER|PROTOCOL|HANDSHAKE|ERR_TLS)_[A-Z0-9_]+|EACCES|ENOENT|EEXIST|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)$/.test(error.code)
    ? error.code : fallback;
}

export async function runDataImport(options, {
  readConfig = readMysqlConfig,
  readExport = loadSqliteExport,
  importData = importMysqlData,
  connect = config => mysql.createConnection(config),
  initialize = initializeMysqlSession,
  write = line => console.log(line),
} = {}) {
  let descriptor, connection, failure, result, dataset;
  let stage = "DATA_IMPORT_INPUT_INVALID";
  try {
    if (options?.apply !== true || ![options?.audit, options?.input, options?.report].every(value => typeof value === "string" && path.isAbsolute(value))) {
      throw Object.assign(new Error(stage), { code: stage });
    }
    descriptor = fs.openSync(options.report, "wx", 0o600);
    stage = "DATA_IMPORT_EXPORT_INVALID";
    const audit = JSON.parse(fs.readFileSync(options.audit, "utf8"));
    dataset = await readExport(options.input, { expectedSourceSha256: REHEARSAL_SOURCE_SHA256, audit });
    stage = "DATA_IMPORT_CONFIG_INVALID";
    const config = readConfig();
    if (config.database !== "outdoor_fit_test") {
      throw Object.assign(new Error("DATA_IMPORT_WRONG_DATABASE"), { code: "DATA_IMPORT_WRONG_DATABASE" });
    }
    stage = "DATA_IMPORT_CONNECT_FAILED";
    connection = await connect({ ...config, supportBigNumbers: true, bigNumberStrings: true });
    stage = "DATA_IMPORT_SESSION_FAILED";
    await initialize(connection);
    stage = "DATA_IMPORT_FAILED";
    result = await importData(connection, dataset, { write });
  } catch (error) {
    failure = safeCode(error, stage);
    if (error?.report) result = error.report;
  } finally {
    if (connection) {
      try { await connection.end(); }
      catch (error) {
        try { connection.destroy(); } catch { /* Preserve the known transaction outcome. */ }
        if (!failure) { stage = "DATA_IMPORT_CLOSE_FAILED"; failure = safeCode(error, stage); }
      }
    }
    if (descriptor !== undefined) {
      try {
        fs.writeFileSync(descriptor, JSON.stringify({
          formatVersion: 1, generatedAtUtc: new Date().toISOString(),
          status: failure ? "failed" : "imported",
          expectedSourceSha256: REHEARSAL_SOURCE_SHA256,
          sourceSha256: dataset?.sourceSha256, exportSha256: dataset?.exportSha256,
          errorCode: failure || null, errorStage: failure ? stage : null, result: result || null,
        }, null, 2) + "\n", "utf8");
        fs.fsyncSync(descriptor);
      } catch (error) {
        if (!failure) { stage = "DATA_IMPORT_REPORT_FAILED"; failure = safeCode(error, stage); }
      } finally {
        try { fs.closeSync(descriptor); }
        catch (error) {
          if (!failure) { stage = "DATA_IMPORT_REPORT_FAILED"; failure = safeCode(error, stage); }
        }
      }
    }
  }
  write("DATA_IMPORT " + (failure ? "FAIL" : "PASS"));
  if (result?.operation && /^[a-z_]+$/.test(result.operation)) write("DATA_OPERATION " + result.operation);
  for (const key of ["table", "column"]) {
    if (typeof result?.[key] === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(result[key])) {
      write("DATA_" + key.toUpperCase() + " " + result[key]);
    }
  }
  if (result?.commitStatus && ["not_started", "not_attempted", "not_committed", "committed", "rolled_back", "unknown"].includes(result.commitStatus)) {
    write("DATA_COMMIT_STATUS " + result.commitStatus);
  }
  if (["not_needed", "rolled_back", "failed"].includes(result?.rollbackStatus)) write("DATA_ROLLBACK_STATUS " + result.rollbackStatus);
  if (failure) {
    write("ERROR_CODE " + failure);
    write("ERROR_STAGE " + stage);
  } else {
    write("TABLE_COUNT " + result.tableCount);
    write("ROW_COUNT " + result.rowCount);
    write("SOURCE_SHA256 " + dataset.sourceSha256);
    write("EXPORT_SHA256 " + dataset.exportSha256);
  }
  if (descriptor !== undefined) write("REPORT_FILE " + options.report);
  return failure ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { audit: { type: "string" }, input: { type: "string" }, report: { type: "string" }, apply: { type: "boolean" } } });
    process.exitCode = await runDataImport(values);
  } catch {
    console.log("DATA_IMPORT FAIL\nERROR_CODE DATA_IMPORT_ARGUMENTS_INVALID");
    process.exitCode = 1;
  }
}
