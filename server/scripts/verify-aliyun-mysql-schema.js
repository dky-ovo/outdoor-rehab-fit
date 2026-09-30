import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { readMysqlConfig } from "../src/mysqlConfig.js";
import { initializeMysqlSession } from "../src/mysqlDatabase.js";
import { buildMysqlSchema } from "../src/mysqlSchema.js";
import { verifyMysqlSchema } from "../src/mysqlSchemaApply.js";

function safeCode(error, fallback) {
  return typeof error?.code === "string" && /^(?:SCHEMA_[A-Z0-9_]+|ER_[A-Z0-9_]+|PROTOCOL_[A-Z0-9_]+|HANDSHAKE_[A-Z0-9_]+|ERR_TLS_[A-Z0-9_]+|EACCES|ENOENT|EEXIST|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)$/.test(error.code)
    ? error.code : fallback;
}

export async function runSchemaVerification(options, {
  readConfig = readMysqlConfig,
  buildSchema = buildMysqlSchema,
  verifySchema = verifyMysqlSchema,
  connect = config => mysql.createConnection(config),
  initialize = initializeMysqlSession,
  write = line => console.log(line),
} = {}) {
  let descriptor, connection, failure, result, schema;
  let stage = "SCHEMA_INPUT_INVALID";
  try {
    if (!path.isAbsolute(options?.audit || "") || !path.isAbsolute(options?.report || "")) {
      throw Object.assign(new Error(stage), { code: stage });
    }
    schema = buildSchema(JSON.parse(fs.readFileSync(options.audit, "utf8")));
    descriptor = fs.openSync(options.report, "wx", 0o600);
    stage = "SCHEMA_CONFIG_INVALID";
    const config = readConfig();
    if (config.database !== "outdoor_fit_test") {
      throw Object.assign(new Error("SCHEMA_WRONG_DATABASE"), { code: "SCHEMA_WRONG_DATABASE" });
    }
    stage = "SCHEMA_CONNECT_FAILED";
    connection = await connect(config);
    stage = "SCHEMA_SESSION_FAILED";
    await initialize(connection);
    stage = "SCHEMA_VERIFY_FAILED";
    result = await verifySchema(connection, schema, { expectedDatabase: "outdoor_fit_test", write });
  } catch (error) {
    failure = safeCode(error, stage);
    if (error?.report) result = error.report;
  } finally {
    if (connection) {
      try { await connection.end(); }
      catch (error) {
        try { connection.destroy(); } catch { /* Preserve the original outcome. */ }
        if (!failure) { stage = "SCHEMA_CLOSE_FAILED"; failure = safeCode(error, stage); }
      }
    }
    if (descriptor !== undefined) {
      try {
        fs.writeFileSync(descriptor, JSON.stringify({
          formatVersion: 1, generatedAtUtc: new Date().toISOString(), mode: "verify-only",
          status: failure ? "failed" : "verified", sourceSchemaHash: schema?.sourceSchemaHash,
          errorCode: failure || null, errorStage: failure ? stage : null, result: result || null,
        }, null, 2) + "\n", "utf8");
        fs.fsyncSync(descriptor);
      } catch (error) {
        if (!failure) { stage = "SCHEMA_REPORT_FAILED"; failure = safeCode(error, stage); }
      } finally {
        try { fs.closeSync(descriptor); }
        catch (error) {
          if (!failure) { stage = "SCHEMA_REPORT_FAILED"; failure = safeCode(error, stage); }
        }
      }
    }
  }
  write("SCHEMA_VERIFY " + (failure ? "FAIL" : "PASS"));
  if (failure) {
    write("ERROR_CODE " + failure);
    write("ERROR_STAGE " + stage);
  } else {
    write("TABLE_COUNT " + schema.tables.length);
    write("SOURCE_COLUMN_COUNT " + schema.tables.reduce((sum, table) => sum + table.columns.length, 0));
    write("FOREIGN_KEY_COUNT " + schema.tables.reduce((sum, table) => sum + table.foreignKeys.length, 0));
    write("SCHEMA_FINGERPRINT " + result.fingerprint);
  }
  if (descriptor !== undefined) write("REPORT_FILE " + options.report);
  return failure ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { audit: { type: "string" }, report: { type: "string" } } });
    process.exitCode = await runSchemaVerification(values);
  } catch {
    console.log("SCHEMA_VERIFY FAIL\nERROR_CODE SCHEMA_ARGUMENTS_INVALID");
    process.exitCode = 1;
  }
}
