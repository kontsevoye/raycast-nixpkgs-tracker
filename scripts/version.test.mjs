import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  bumpVersion,
  changeLevel,
  compareVersions,
  parseVersion,
  planRelease,
} from "./version.mjs";

test("stable SemVer is ordered numerically and increments reset lower components", () => {
  assert.equal(compareVersions("v0.10.0", "v0.9.99"), 1);
  for (const invalid of [
    "0.1.0",
    "v01.1.0",
    "v0.1.0-beta.1",
    "v1.2",
    "v1.2.3.4",
  ])
    assert.equal(parseVersion(invalid), undefined);
  assert.equal(bumpVersion("v0.1.9", "patch"), "v0.1.10");
  assert.equal(bumpVersion("v0.1.9", "minor"), "v0.2.0");
  assert.equal(bumpVersion("v0.1.9", "major"), "v1.0.0");
});

test("highest Conventional Commit level wins; other messages default to patch", () => {
  assert.equal(
    changeLevel([
      "fix: repair lookup",
      "docs: explain tokens",
      "Update dependencies",
    ]),
    "patch",
  );
  assert.equal(
    changeLevel(["fix: repair lookup", "feat(auth): add sign-in"]),
    "minor",
  );
  for (const message of [
    "feat!: remove compatibility",
    "refactor(api)!: change contract",
    "chore: update\n\nBREAKING CHANGE: old preferences are removed",
    "fix: update\n\nBREAKING-CHANGE: old preferences are removed",
  ]) {
    assert.equal(changeLevel(["feat: new UI", message]), "major", message);
  }
  assert.equal(changeLevel(["docs: explain feat: syntax"]), "patch");
});

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "nixpkgs-release-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    }).trim();
  git("init", "--quiet", "-b", "main");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "test@example.invalid");
  const commit = (message) => {
    git("commit", "--quiet", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  return { cwd, git, commit };
}

test("plans from all unreleased commits, resumes a tagged commit, and ignores non-stable tags", (t) => {
  const { cwd, git, commit } = fixture(t);
  commit("Initial version");
  git("tag", "-a", "v0.1.0", "-m", "Initial release");
  commit("fix: patch");
  commit("feat: new action");
  const sha = commit("docs: explain action");
  git("tag", "v100.0.0-beta.1");
  const plan = planRelease(cwd);
  assert.deepEqual(plan, {
    tag: "v0.2.0",
    sha,
    previousTag: "v0.1.0",
    existingTag: false,
    latest: true,
    level: "minor",
    commits: 3,
  });
  git("tag", "-a", plan.tag, "-m", "Automated release");
  assert.deepEqual(planRelease(cwd), {
    tag: "v0.2.0",
    sha,
    previousTag: "v0.1.0",
    existingTag: true,
    latest: true,
  });
});

test("a late older push is skipped after a newer commit has already been tagged", (t) => {
  const { cwd, git, commit } = fixture(t);
  commit("Initial version");
  git("tag", "v0.1.0");
  const older = commit("fix: older push");
  commit("fix: newer push");
  git("tag", "v0.1.1");
  assert.equal(planRelease(cwd, older).skip, true);
});

test("a repository with no release tags starts with the appropriate SemVer increment", (t) => {
  const { cwd, commit } = fixture(t);
  commit("feat: first feature");
  assert.equal(planRelease(cwd).tag, "v0.1.0");
});
