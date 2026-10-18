import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";

if (!process.env.DATABASE_URL)
  throw new Error("Configura DATABASE_URL o ejecuta npm run setup");
const base = new URL(process.env.DATABASE_URL);
const control = new pg.Client({ connectionString: base.toString() });
await control.connect();
try {
  const stages = process.argv.includes("--api")
    ? ["api"]
    : process.argv.includes("--ui")
      ? ["ui"]
      : ["api", "ui"];
  for (const stage of stages) {
    const name = `bar_test_${randomBytes(8).toString("hex")}`;
    await control.query(`CREATE DATABASE "${name}"`);
    try {
      base.pathname = `/${name}`;
      const files = (await readdir("tests"))
        .filter((f) => f.endsWith(".test.ts"))
        .map((f) => `tests/${f}`);
      const args =
        stage === "api"
          ? ["--import", "tsx", "--test", "--test-concurrency=1", ...files]
          : ["node_modules/@playwright/test/cli.js", "test"];
      const child = spawn(process.execPath, args, {
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: base.toString(),
          APP_ORIGIN: `http://localhost:${stage === "ui" ? 3183 : 3182}`,
          NODE_ENV: "test",
          SECURE_COOKIES: "false",
        },
      });
      const status = await new Promise<number>((resolve) => {
        child.on("exit", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
      });
      if (status) {
        process.exitCode = status;
        break;
      }
    } finally {
      await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  }
} finally {
  await control.end();
}
