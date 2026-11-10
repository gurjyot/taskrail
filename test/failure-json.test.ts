import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { scaffoldAutomation } from "../src/automation-scaffold.js";
test("failed check JSON is parseable, detailed and nonzero", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskrail-json-"));
  try {
    const created = await scaffoldAutomation({
      name: "json-check",
      profile: "portable-node@1",
      root,
    });
    const file = path.join(created.path!, "automation.json");
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.requiredSharedFiles = [
      {
        path: path.join(root, "missing"),
        environments: ["local", "ci", "production"],
      },
    ];
    await writeFile(file, JSON.stringify(manifest));
    const run = spawnSync(
      process.execPath,
      [path.resolve("dist/src/taskrail-cli.js"), "check", file, "--json"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TASKRAIL_ENV: "production",
          TASKRAIL_UPDATE_NOTICES: "0",
        },
      },
    );
    assert.notEqual(run.status, 0);
    const result = JSON.parse(run.stdout);
    assert.equal(result.ok, false);
    assert.ok(
      result.checks.some(
        (x: { name: string; ok: boolean }) =>
          x.name.startsWith("shared:") && !x.ok,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
