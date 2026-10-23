import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkBranches,
  DEFAULT_BRANCHES,
  getBranches,
  GitHub,
  GitHubError,
  parsePR,
} from "./github";

const sha = "a".repeat(40);
const fixture = {
  number: 576853,
  title: "Example package update",
  state: "closed",
  merged_at: "2026-10-21T10:00:00Z",
  merge_commit_sha: sha,
  base: { ref: "master" },
};

test("accepts PR numbers and supported URLs while rejecting other repositories and unsafe input", () => {
  for (const value of [
    "576853",
    " #576853 ",
    "https://github.com/NixOS/nixpkgs/pull/576853",
    "https://github.com/NixOS/nixpkgs/pull/576853/files#diff",
    "https://track.nix.ee/?pr=576853",
  ]) {
    assert.equal(parsePR(value), 576853, value);
  }
  for (const value of [
    "",
    "0",
    "-1",
    "1.2",
    "1e5",
    "9007199254740992",
    "https://github.com/other/repo/pull/576853",
    "https://github.com.evil.test/NixOS/nixpkgs/pull/576853",
    "https://evil.test/?pr=576853",
    "https://x@github.com/NixOS/nixpkgs/pull/576853",
  ]) {
    assert.equal(parsePR(value), undefined, value);
  }
});

test("adds the PR target, deduplicates preferences and rejects malformed refs", () => {
  assert.deepEqual(
    getBranches("master, nixpkgs-unstable,master", "release-26.05"),
    ["master", "nixpkgs-unstable", "release-26.05"],
  );
  assert.deepEqual(getBranches(undefined, "master"), DEFAULT_BRANCHES);
  assert.throws(() => getBranches("../main", "master"), /Invalid branch/);
  assert.throws(
    () => getBranches("feature/.hidden", "master"),
    /Invalid branch/,
  );
  assert.throws(() => getBranches("branch.lock", "master"), /Invalid branch/);
});

test("comparison direction: branch ahead/identical to merge commit means reached, behind/diverged means absent", async () => {
  for (const [status, expected] of [
    ["ahead", true],
    ["identical", true],
    ["behind", false],
    ["diverged", false],
  ] as const) {
    const github = new GitHub("test-only-placeholder", async (url, init) => {
      assert.equal(
        url,
        `https://api.github.com/repos/NixOS/nixpkgs/compare/${sha}...feature%2Ftest?per_page=1`,
      );
      assert.equal(
        (init.headers as Record<string, string>).Authorization,
        "Bearer test-only-placeholder",
      );
      return Response.json({ status });
    });
    assert.equal(await github.contains("feature/test", sha), expected);
  }
});

test("anonymous requests omit authorization; PR data is validated", async () => {
  const github = new GitHub(undefined, async (_url, init) => {
    assert.equal(
      "Authorization" in (init.headers as Record<string, string>),
      false,
    );
    return Response.json(fixture);
  });
  const pr = await github.pullRequest(576853);
  assert.equal(pr.html_url, "https://github.com/NixOS/nixpkgs/pull/576853");
  const malformed = new GitHub(undefined, async () =>
    Response.json({ ...fixture, merge_commit_sha: "invalid" }),
  );
  await assert.rejects(
    () => malformed.pullRequest(576853),
    /unexpected PR response/,
  );
});

test("invalid tokens, rate limits and missing branches never become a false not-reached result", async () => {
  for (const [status, headers, message] of [
    [401, {}, /expired or invalid/],
    [403, { "x-ratelimit-remaining": "0" }, /rate limit/],
    [429, {}, /rate limit/],
    [404, {}, /not found/],
    [503, {}, /HTTP 503/],
  ] as const) {
    const github = new GitHub(
      undefined,
      async () => new Response("", { status, headers }),
    );
    await assert.rejects(
      () => github.contains("master", sha),
      (error) => error instanceof GitHubError && message.test(error.message),
    );
  }
  const malformed = new GitHub(undefined, async () =>
    Response.json({ status: "unknown" }),
  );
  await assert.rejects(
    () => malformed.contains("master", sha),
    /unexpected comparison/,
  );
});

test("partial branch failures stay visible and comparisons have bounded concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const github = new GitHub(undefined, async (url) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return url.includes("missing")
      ? new Response("", { status: 404 })
      : Response.json({ status: "ahead" });
  });
  const results: { name: string; state: string }[] = [];
  await checkBranches(
    github,
    ["master", "missing", "staging", "staging-next", "nixpkgs-unstable"],
    sha,
    new AbortController().signal,
    (result) => results.push(result),
  );
  assert.equal(maximum, 3);
  assert.equal(results.length, 5);
  assert.equal(results.find((item) => item.name === "missing")?.state, "error");
  assert.equal(results.filter((item) => item.state === "present").length, 4);
});

test("cancelled checks cannot publish results into a newer PR view", async () => {
  const controller = new AbortController();
  const github = new GitHub(undefined, async () => {
    controller.abort();
    return Response.json({ status: "ahead" });
  });
  const results: unknown[] = [];
  await checkBranches(
    github,
    ["master", "staging"],
    sha,
    controller.signal,
    (result) => results.push(result),
  );
  assert.deepEqual(results, []);
});
