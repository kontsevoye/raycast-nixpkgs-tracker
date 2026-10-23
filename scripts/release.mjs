import { execFileSync } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planRelease } from "./version.mjs";

export const ASSET_NAME = "nixpkgs-tracker.rayext";

const runGh = (args, input) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    stdio: ["pipe", "pipe", "pipe"],
  });

// The injected CLI runner lets tests exercise recovery without publishing anything.
export function publishRelease(plan, repository, artifact, gh = runGh) {
  if (plan.skip) return { status: "skipped", reason: plan.reason };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid GitHub repository.");
  const endpoint = `repos/${repository}`;
  let release;
  try {
    release = JSON.parse(gh(["api", `${endpoint}/releases/tags/${plan.tag}`]));
  } catch (error) {
    if (!/HTTP 404/.test(String(error.stderr))) throw error;
  }

  const hasAsset = release?.assets.some((asset) => asset.name === ASSET_NAME);
  if (release && !release.draft && hasAsset) {
    return {
      status: "already-published",
      tag: plan.tag,
      url: release.html_url,
    };
  }

  if (!plan.existingTag) {
    const tag = JSON.parse(
      gh(["api", "--method", "POST", `${endpoint}/git/tags`, "--input", "-"], {
        tag: plan.tag,
        message: `${plan.tag}\n\nAutomated release of ${plan.sha}.`,
        object: plan.sha,
        type: "commit",
      }),
    );
    gh(["api", "--method", "POST", `${endpoint}/git/refs`, "--input", "-"], {
      ref: `refs/tags/${plan.tag}`,
      sha: tag.sha,
    });
  }

  if (!release) {
    const args = [
      "release",
      "create",
      plan.tag,
      "--repo",
      repository,
      "--verify-tag",
      "--draft",
      "--generate-notes",
      "--title",
      `${plan.tag} — NixPkgs PR Tracker`,
    ];
    if (plan.previousTag) args.push("--notes-start-tag", plan.previousTag);
    gh(args);
  }
  // Never overwrite an already-uploaded bundle on retries.
  if (!hasAsset)
    gh(["release", "upload", plan.tag, artifact, "--repo", repository]);
  if (!release || release.draft) {
    gh([
      "release",
      "edit",
      plan.tag,
      "--repo",
      repository,
      "--draft=false",
      `--latest=${plan.latest}`,
    ]);
  }
  return {
    status: "published",
    tag: plan.tag,
    url: `https://github.com/${repository}/releases/tag/${plan.tag}`,
  };
}

function main() {
  const publish = process.argv.includes("--publish");
  if (publish) {
    if (
      process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_EVENT_NAME !== "push" ||
      process.env.GITHUB_REF !== "refs/heads/main"
    ) {
      throw new Error(
        "Publishing is only allowed in the main-branch push workflow.",
      );
    }
    if (!process.env.GH_TOKEN)
      throw new Error("The release job requires GH_TOKEN.");
    // The workflow serializes pushes; refresh tags before allocating the next version.
    execFileSync("git", ["fetch", "origin", "--tags"], { stdio: "inherit" });
  }
  const plan = planRelease();
  if (!publish) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (plan.sha !== process.env.GITHUB_SHA)
    throw new Error("Checkout does not match the tested push commit.");
  const artifact = resolve(ASSET_NAME);
  if (
    !plan.skip &&
    (!statSync(artifact).isFile() || statSync(artifact).size === 0)
  )
    throw new Error("Missing release bundle.");
  const result = publishRelease(plan, process.env.GITHUB_REPOSITORY, artifact);
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Release\n\n${result.status}: ${result.url ? `[${result.tag}](${result.url})` : result.reason}\n`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();
