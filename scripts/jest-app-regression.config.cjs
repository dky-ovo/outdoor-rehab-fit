const path = require("node:path");

// Deployment archives and local QA workspaces can contain copies of package.json
// or app code. They are not application test sources and must not be indexed.
module.exports = {
  ...require("../package.json").jest,
  rootDir: path.resolve(__dirname, ".."),
  testMatch: ["**/__tests__/**/*.[jt]s?(x)"],
  modulePathIgnorePatterns: [
    "<rootDir>/workspace-artifacts/",
    "<rootDir>/deploy/",
    "<rootDir>/tmp/",
    "<rootDir>/artifacts/",
  ],
};
