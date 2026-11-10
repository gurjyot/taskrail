import { readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { inspectGitState } from "./git.js";
import { sha256 } from "./provenance.js";

export async function inspectWorkspaceDeployment(cwd = process.cwd()) {
  const file =
    process.env.TASKRAIL_DEPLOYMENT_RECEIPT_FILE ||
    path.join(cwd, ".taskrail", "deployment.json");
  let receipt;
  try {
    receipt = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
  if (
    receipt.schema !== 1 ||
    !/^[a-f0-9]{40}$/.test(receipt.revision) ||
    !receipt.files ||
    typeof receipt.files !== "object" ||
    Array.isArray(receipt.files)
  ) {
    return { status: "unknown", detail: "Invalid deployment receipt" };
  }
  const root = await realpath(cwd);
  const unexpected = new Set<string>();
  const verified = new Set<string>();
  for (const [name, digest] of Object.entries(receipt.files)) {
    const target = path.resolve(root, name);
    if (
      !name ||
      path.isAbsolute(name) ||
      path.relative(root, target).startsWith("..") ||
      !/^[a-f0-9]{64}$/.test(String(digest))
    ) {
      return { status: "unknown", detail: "Invalid deployment file contract" };
    }
    try {
      if (
        (await lstat(target)).isSymbolicLink() ||
        !path
          .relative(root, await realpath(target))
          .split(path.sep)
          .every((part) => part !== "..")
      )
        throw new Error("unsafe path");
      if (sha256(await readFile(target)) !== digest) unexpected.add(name);
      else verified.add(name);
    } catch {
      unexpected.add(name);
    }
  }
  const git = inspectGitState(cwd);
  const changed = git.changedFiles ?? [];
  const preserved = Array.isArray(receipt.preservedPaths)
    ? receipt.preservedPaths.filter(
        (item: unknown): item is string => typeof item === "string",
      )
    : [];
  for (const name of changed)
    if (!verified.has(name) && !preserved.includes(name)) unexpected.add(name);
  return {
    status: unexpected.size ? "drifted" : "verified",
    repository:
      typeof receipt.repository === "string" ? receipt.repository : null,
    sourceRevision: receipt.revision,
    checkoutRevision: git.sha ?? null,
    deployedAt: receipt.deployedAt ?? null,
    expectedDeploymentChanges: changed.filter((name) => verified.has(name)),
    preservedLocalChanges: changed.filter((name) => preserved.includes(name)),
    unexpectedChanges: [...unexpected].sort(),
  };
}
