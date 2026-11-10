import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { sha256 } from "../src/provenance.js";
import { inspectWorkspaceDeployment } from "../src/workspace-deployment.js";
test("receipt separates deployed files from unexpected changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskrail-receipt-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: root });
    await writeFile(path.join(root, "file.txt"), "deployed");
    await mkdir(path.join(root, ".taskrail"));
    await writeFile(
      path.join(root, ".taskrail/deployment.json"),
      JSON.stringify({
        schema: 1,
        revision: "a".repeat(40),
        files: { "file.txt": sha256("deployed") },
      }),
    );
    const first = await inspectWorkspaceDeployment(root);
    assert.equal(first?.status, "verified");
    await writeFile(path.join(root, "file.txt"), "unexpected");
    const second = await inspectWorkspaceDeployment(root);
    assert.equal(second?.status, "drifted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
