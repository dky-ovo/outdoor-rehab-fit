// Pipe into the existing API image with `node --input-type=module -` in /app.
// Read-only deployment check; never import production.js or print secrets.
import fs from "node:fs";
import mysql from "mysql2/promise";
import { checkServerIdentity } from "node:tls";
import { readMysqlConfig } from "./src/mysqlConfig.js";
import { initializeMysqlSession } from "./src/mysqlDatabase.js";

let connection, stage = "CONFIG";
try {
  const password = fs.readFileSync(process.env.MYSQL_PASSWORD_FILE, "utf8");
  if (!password || /[\0\r\n]/.test(password)) throw new Error();
  const config = readMysqlConfig({ ...process.env, MYSQL_PASSWORD: password });
  if (config.user !== "outdoor_fit_app" || config.database !== "outdoor_fit_prod") throw new Error();
  stage = "CONNECT";
  connection = await mysql.createConnection(config);
  stage = "TLS";
  const socket = connection.connection.stream;
  if (!socket.encrypted || !socket.authorized ||
      checkServerIdentity(config.host, socket.getPeerCertificate(true))) throw new Error();
  stage = "SESSION";
  await initializeMysqlSession(connection);
  stage = "METADATA";
  const [[info]] = await connection.query("SELECT DATABASE() AS db, CURRENT_USER() AS account");
  const [[count]] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'");
  if (info.db !== "outdoor_fit_prod" || !String(info.account).startsWith("outdoor_fit_app@") || Number(count.n) !== 38) throw new Error();
  console.log("APP_DATABASE=" + info.db);
  console.log("APP_ACCOUNT=" + info.account);
  console.log("APP_TLS=" + socket.getProtocol());
  console.log("APP_IDENTITY_VERIFIED=PASS");
  console.log("APP_TABLE_COUNT=" + count.n);
  stage = "GRANTS";
  const [grants] = await connection.query("SHOW GRANTS FOR CURRENT_USER");
  for (const row of grants) console.log("APP_GRANT=" + Object.values(row)[0]);
  stage = "CLOSE";
  await connection.end();
  connection = undefined;
  console.log("APP_DB_CONNECTION=PASS");
} catch (error) {
  console.error("APP_DB_CONNECTION=FAIL");
  console.error("ERROR_STAGE=" + stage);
  console.error("ERROR_CODE=" + (/^[A-Z0-9_]{1,64}$/.test(error?.code || "") ? error.code : "APP_CONFIG_OR_CONNECTION_FAILED"));
  process.exitCode = 1;
} finally {
  connection?.destroy();
}
