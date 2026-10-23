import { execFileSync } from "node:child_process";

export function parseVersion(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!match) return undefined;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error("Expected stable vMAJOR.MINOR.PATCH tags.");
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function changeLevel(messages) {
  if (
    messages.some(
      (message) =>
        /^[a-z][\w-]*(?:\([^\r\n)]+\))?!:[ \t]/i.test(message) ||
        /^BREAKING[ -]CHANGE:[ \t]*\S/m.test(message),
    )
  ) {
    return "major";
  }
  return messages.some((message) =>
    /^feat(?:\([^\r\n)]+\))?:[ \t]/.test(message),
  )
    ? "minor"
    : "patch";
}

export function bumpVersion(tag, level) {
  const parts = parseVersion(tag);
  if (!parts) throw new Error(`Invalid version tag: ${tag}`);
  const index = { major: 0, minor: 1, patch: 2 }[level];
  if (index === undefined)
    throw new Error(`Invalid version increment: ${level}`);
  parts[index]++;
  for (let next = index + 1; next < 3; next++) parts[next] = 0;
  if (!parts.every(Number.isSafeInteger))
    throw new Error("Version is too large.");
  return `v${parts.join(".")}`;
}

export function planRelease(cwd = process.cwd(), revision = "HEAD") {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    throw new Error(
      "Release planning requires complete Git history and tags (fetch-depth: 0).",
    );
  }
  const sha = git("rev-parse", "--verify", `${revision}^{commit}`);
  const tags = git("tag", "--list", "v*")
    .split("\n")
    .filter((tag) => parseVersion(tag))
    .sort((a, b) => compareVersions(b, a));
  const tagged = tags.map((tag) => ({
    tag,
    sha: git("rev-parse", `${tag}^{commit}`),
  }));
  function isAncestor(ancestor) {
    try {
      git("merge-base", "--is-ancestor", ancestor, sha);
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw error;
    }
  }

  const existing = tagged.find((item) => item.sha === sha);
  if (existing) {
    const previous = tagged.find(
      (item) => item.sha !== sha && isAncestor(item.sha),
    );
    return {
      tag: existing.tag,
      sha,
      previousTag: previous?.tag,
      existingTag: true,
      latest: existing.tag === tags[0],
    };
  }

  const previous = tagged[0];
  // A delayed/retried older push must not publish a new version of old code.
  if (previous && !isAncestor(previous.sha)) {
    return {
      skip: true,
      sha,
      reason: `Newest version ${previous.tag} is not an ancestor of this commit.`,
    };
  }
  const range = previous ? `${previous.tag}..${sha}` : sha;
  const messages = git("log", "--format=%B%x00", range)
    .split("\0")
    .map((message) => message.trim())
    .filter(Boolean);
  if (messages.length === 0)
    return { skip: true, sha, reason: "No unreleased commits." };
  const level = changeLevel(messages);
  return {
    tag: bumpVersion(previous?.tag ?? "v0.0.0", level),
    sha,
    previousTag: previous?.tag,
    existingTag: false,
    latest: true,
    level,
    commits: messages.length,
  };
}
