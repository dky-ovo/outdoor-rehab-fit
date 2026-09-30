import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runSchemaVerification } from "../scripts/verify-aliyun-mysql-schema.js";

const workspace = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(workspace, ".mysql-schema-verify-test-"));
  t.after(() => {
    assert.equal(path.dirname(directory), workspace);
    assert.ok(path.basename(directory).startsWith(".mysql-schema-verify-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const audit = path.join(directory, "audit.json"), report = path.join(directory, "report.json");
  fs.writeFileSync(audit, "{}\n");
  const calls = [], output = [];
  const connection = { async end() { calls.push("end"); }, destroy() { calls.push("destroy"); } };
  const dependencies = {
    readConfig: () => ({ database: "outdoor_fit_test" }),
    buildSchema: () => ({ sourceSchemaHash: "a".repeat(64), tables: [{ columns: [{}], foreignKeys: [] }] }),
    connect: async () => { calls.push("connect"); return connection; },
    initialize: async () => { calls.push("initialize"); },
    verifySchema: async () => { calls.push("verify"); return { status: "verified", fingerprint: "b".repeat(64) }; },
    write: line => output.push(line),
  };
  return { options: { audit, report }, calls, output, connection, dependencies };
}

test("verification CLI reports verified, reserves a fresh report and closes its connection", async t => {
  const f = fixture(t);
  assert.equal(await runSchemaVerification(f.options, f.dependencies), 0);
  assert.deepEqual(f.calls, ["connect", "initialize", "verify", "end"]);
  const report = JSON.parse(fs.readFileSync(f.options.report, "utf8"));
  assert.equal(report.mode, "verify-only");
  assert.equal(report.status, "verified");
  assert.ok(f.output.includes("SCHEMA_VERIFY PASS"));
  assert.ok(f.output.every(line => !line.includes("SCHEMA_CREATE")));
});

test("verification refuses existing reports and production database before connecting", async t => {
  const f = fixture(t);
  fs.writeFileSync(f.options.report, "original");
  assert.equal(await runSchemaVerification(f.options, f.dependencies), 1);
  assert.equal(fs.readFileSync(f.options.report, "utf8"), "original");
  f.options.report = path.join(path.dirname(f.options.report), "prod-refused.json");
  f.dependencies.readConfig = () => ({ database: "outdoor_fit_prod" });
  assert.equal(await runSchemaVerification(f.options, f.dependencies), 1);
  assert.deepEqual(f.calls, []);
});

test("verification records safe error context without raw driver text and still closes", async t => {
  const f = fixture(t);
  f.dependencies.verifySchema = async () => {
    throw Object.assign(new Error("sensitive raw driver text"), {
      code: "SCHEMA_EXPRESSION_UNSUPPORTED",
      report: { status: "failed", operation: "verify_columns", table: "users", column: "__email_sha256", metadataKind: "generated_expression" },
    });
  };
  assert.equal(await runSchemaVerification(f.options, f.dependencies), 1);
  assert.deepEqual(f.calls, ["connect", "initialize", "end"]);
  const raw = fs.readFileSync(f.options.report, "utf8");
  assert.equal(JSON.parse(raw).result.column, "__email_sha256");
  assert.doesNotMatch(raw + f.output.join("\n"), /sensitive|raw driver/);
});
