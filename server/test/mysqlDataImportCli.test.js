import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runDataImport, REHEARSAL_SOURCE_SHA256 } from "../scripts/import-aliyun-mysql-data.js";

const workspace = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(workspace, ".mysql-data-import-cli-test-"));
  t.after(() => {
    assert.equal(path.dirname(directory), workspace);
    assert.ok(path.basename(directory).startsWith(".mysql-data-import-cli-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const options = { audit: path.join(directory, "audit.json"), input: path.join(directory, "synthetic.jsonl"), report: path.join(directory, "report.json"), apply: true };
  fs.writeFileSync(options.audit, "{}\n");
  const calls = [], output = [];
  const connection = { async end() { calls.push("end"); }, destroy() { calls.push("destroy"); } };
  const dependencies = {
    readExport: async (input, readerOptions) => {
      calls.push("read");
      assert.equal(readerOptions.expectedSourceSha256, REHEARSAL_SOURCE_SHA256);
      return { sourceSha256: REHEARSAL_SOURCE_SHA256, exportSha256: "a".repeat(64) };
    },
    readConfig: () => ({ database: "outdoor_fit_test" }),
    connect: async config => {
      calls.push("connect");
      assert.equal(config.supportBigNumbers, true);
      assert.equal(config.bigNumberStrings, true);
      return connection;
    },
    initialize: async () => { calls.push("initialize"); },
    importData: async () => { calls.push("import"); return { status: "imported", commitStatus: "committed", tableCount: 38, rowCount: 3 }; },
    write: line => output.push(line),
  };
  return { options, calls, output, connection, dependencies };
}

test("import CLI validates source before connecting and records the committed result", async t => {
  const f = fixture(t);
  assert.equal(await runDataImport(f.options, f.dependencies), 0);
  assert.deepEqual(f.calls, ["read", "connect", "initialize", "import", "end"]);
  assert.ok(f.output.includes("DATA_COMMIT_STATUS committed"));
  assert.equal(JSON.parse(fs.readFileSync(f.options.report, "utf8")).status, "imported");
});

test("missing apply, invalid export, existing report and production database never reach import", async t => {
  const f = fixture(t);
  assert.equal(await runDataImport({ ...f.options, apply: false }, f.dependencies), 1);
  assert.deepEqual(f.calls, []);
  f.dependencies.readExport = () => { throw Object.assign(new Error("private row"), { code: "SQLITE_EXPORT_HASH_MISMATCH" }); };
  assert.equal(await runDataImport(f.options, f.dependencies), 1);
  const firstReport = fs.readFileSync(f.options.report, "utf8");
  assert.equal(await runDataImport(f.options, f.dependencies), 1);
  assert.equal(fs.readFileSync(f.options.report, "utf8"), firstReport);
  f.options.report = path.join(path.dirname(f.options.report), "production-refused.json");
  f.dependencies.readExport = () => ({});
  f.dependencies.readConfig = () => ({ database: "outdoor_fit_prod" });
  assert.equal(await runDataImport(f.options, f.dependencies), 1);
  assert.deepEqual(f.calls, []);
  assert.doesNotMatch(firstReport, /private row/);
});

test("unknown commit result survives connection-close failure without disclosing driver text", async t => {
  const f = fixture(t);
  f.dependencies.importData = async () => {
    throw Object.assign(new Error("private SQL parameters"), { code: "IMPORT_COMMIT_UNKNOWN", report: { status: "failed", commitStatus: "unknown" } });
  };
  f.connection.end = async () => { throw new Error("private close details"); };
  assert.equal(await runDataImport(f.options, f.dependencies), 1);
  assert.ok(f.output.includes("DATA_COMMIT_STATUS unknown"));
  assert.ok(f.calls.includes("destroy"));
  const report = fs.readFileSync(f.options.report, "utf8");
  assert.equal(JSON.parse(report).result.commitStatus, "unknown");
  assert.doesNotMatch(report + f.output.join("\n"), /private|parameters/);
});
