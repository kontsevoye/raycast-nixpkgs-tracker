import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSET_NAME, publishRelease } from "./release.mjs";

const plan = {
  tag: "v0.1.1",
  previousTag: "v0.1.0",
  sha: "a".repeat(40),
  existingTag: false,
  latest: true,
};
const repository = "example/tracker";
const artifact = "/tmp/nixpkgs-tracker.rayext";

function fakeGh({ release, failUpload = false } = {}) {
  const calls = [];
  const gh = (args, input) => {
    calls.push({ args, input });
    if (args[0] === "api" && args[1].includes("/releases/tags/")) {
      if (release) return JSON.stringify(release);
      const error = new Error("Not found");
      error.stderr = "gh: Not Found (HTTP 404)";
      throw error;
    }
    if (args[0] === "api" && args.includes(`repos/${repository}/git/tags`))
      return JSON.stringify({ sha: "b".repeat(40) });
    if (args[0] === "release" && args[1] === "upload" && failUpload)
      throw new Error("Upload interrupted");
    return "";
  };
  return { gh, calls };
}

test("creates an annotated tag for the tested SHA, uploads into a draft, then publishes", () => {
  const { gh, calls } = fakeGh();
  assert.equal(
    publishRelease(plan, repository, artifact, gh).status,
    "published",
  );
  assert.equal(calls[1].input.object, plan.sha);
  assert.equal(calls[1].input.type, "commit");
  assert.deepEqual(calls[2].input, {
    ref: "refs/tags/v0.1.1",
    sha: "b".repeat(40),
  });
  const releaseCalls = calls.filter(({ args }) => args[0] === "release");
  assert.deepEqual(
    releaseCalls.map(({ args }) => args[1]),
    ["create", "upload", "edit"],
  );
  assert.ok(releaseCalls[0].args.includes("--draft"));
  assert.ok(releaseCalls[0].args.includes("--notes-start-tag"));
  assert.ok(releaseCalls[2].args.includes("--draft=false"));
});

test("a completed release is immutable and repeated workflow runs are a no-op", () => {
  const { gh, calls } = fakeGh({
    release: {
      draft: false,
      assets: [{ name: ASSET_NAME }],
      html_url: "https://example.invalid/release",
    },
  });
  assert.equal(
    publishRelease({ ...plan, existingTag: true }, repository, artifact, gh)
      .status,
    "already-published",
  );
  assert.equal(calls.length, 1);
});

test("resumes a failed draft without replacing an existing tag or asset", () => {
  const { gh, calls } = fakeGh({
    release: { draft: true, assets: [{ name: ASSET_NAME }] },
  });
  publishRelease({ ...plan, existingTag: true }, repository, artifact, gh);
  assert.deepEqual(
    calls.slice(1).map(({ args }) => args.slice(0, 2)),
    [["release", "edit"]],
  );
});

test("upload failure leaves the release unpublished and a retry can finish it", () => {
  const { gh, calls } = fakeGh({ failUpload: true });
  assert.throws(
    () => publishRelease(plan, repository, artifact, gh),
    /Upload interrupted/,
  );
  assert.equal(
    calls.some(({ args }) => args[0] === "release" && args[1] === "edit"),
    false,
  );
  const retry = fakeGh({ release: { draft: true, assets: [] } });
  publishRelease(
    { ...plan, existingTag: true },
    repository,
    artifact,
    retry.gh,
  );
  assert.deepEqual(
    retry.calls.slice(1).map(({ args }) => args.slice(0, 2)),
    [
      ["release", "upload"],
      ["release", "edit"],
    ],
  );
});

test("superseded commits do not call GitHub at all", () => {
  const { gh, calls } = fakeGh();
  assert.equal(
    publishRelease(
      { skip: true, reason: "Superseded" },
      repository,
      artifact,
      gh,
    ).status,
    "skipped",
  );
  assert.equal(calls.length, 0);
});
