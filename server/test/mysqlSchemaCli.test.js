import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runSchemaCreation } from "../scripts/create-aliyun-mysql-schema.js";

const workspace = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(workspace, ".mysql-schema-cli-test-"));
  t.after(() => {
    assert.equal(path.dirname(directory), workspace);
    assert.ok(path.basename(directory).startsWith(".mysql-schema-cli-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const audit = path.join(directory, "audit.json");
  const report = path.join(directory, "report.json");
  fs.writeFileSync(audit, "{}\n");
  const calls = [];
  const output = [];
  const connection = {
    async end() { calls.push("end"); },
    destroy() { calls.push("destroy"); },
  };
  const dependencies = {
    readConfig: () => ({ database: "outdoor_fit_test" }),
    buildSchema: () => ({ sourceSchemaHash: "a".repeat(64), tables: [{ name: "synthetic", columns: [{}], foreignKeys: [] }] }),
    connect: async () => { calls.push("connect"); return connection; },
    initialize: async () => { calls.push("initialize"); },
    applySchema: async () => { calls.push("apply"); return { status: "applied", createdTables: 1, fingerprint: "b".repeat(64) }; },
    write: (line) => output.push(line),
  };
  return { options: { audit, report, apply: true }, calls, output, connection, dependencies };
}

test("schema CLI reserves a new report and writes safe results after connection cleanup", async (t) => {
  const { options, calls, output, dependencies } = fixture(t);
  assert.equal(await runSchemaCreation(options, dependencies), 0);
  assert.deepEqual(calls, ["connect", "initialize", "apply", "end"]);
  const report = JSON.parse(fs.readFileSync(options.report, "utf8"));
  assert.equal(report.status, "applied");
  assert.equal(report.result.fingerprint, "b".repeat(64));
  assert.ok(output.includes("SCHEMA_CREATE PASS"));
  assert.ok(output.includes("TABLE_COUNT 1"));
});

test("schema CLI never connects for an existing report or a missing explicit apply argument", async (t) => {
  const { options, calls, dependencies } = fixture(t);
  fs.writeFileSync(options.report, "previous report");
  assert.equal(await runSchemaCreation(options, dependencies), 1);
  assert.equal(fs.readFileSync(options.report, "utf8"), "previous report");
  assert.deepEqual(calls, []);
  assert.equal(await runSchemaCreation({ ...options, apply: false }, dependencies), 1);
  assert.deepEqual(calls, []);
});

test("schema CLI refuses a production database before connecting", async (t) => {
  const { options, calls, dependencies, output } = fixture(t);
  dependencies.readConfig = () => ({ database: "outdoor_fit_prod" });
  assert.equal(await runSchemaCreation(options, dependencies), 1);
  assert.deepEqual(calls, []);
  assert.ok(output.includes("ERROR_CODE SCHEMA_WRONG_DATABASE"));
});

test("partial DDL failure is recorded and never retried or hidden by a close error", async (t) => {
  const { options, calls, connection, dependencies, output } = fixture(t);
  dependencies.applySchema = async () => {
    calls.push("apply");
    throw Object.assign(new Error("never-print-password-or-SQL"), {
      code: "ER_TABLEACCESS_DENIED_ERROR", sql: "secret", report: { status: "failed", partial: true, createdTables: 3, operationIndex: 4 },
    });
  };
  connection.end = async () => { calls.push("end"); throw new Error("secret close error"); };
  assert.equal(await runSchemaCreation(options, dependencies), 1);
  assert.deepEqual(calls, ["connect", "initialize", "apply", "end", "destroy"]);
  const reportText = fs.readFileSync(options.report, "utf8");
  assert.equal(JSON.parse(reportText).result.partial, true);
  assert.ok(output.includes("ERROR_CODE ER_TABLEACCESS_DENIED_ERROR"));
  assert.doesNotMatch(reportText + output.join("\n"), /never-print|secret/);
});
