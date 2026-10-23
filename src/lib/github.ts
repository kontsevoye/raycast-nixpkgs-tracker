export const DEFAULT_BRANCHES = [
  "staging",
  "staging-next",
  "master",
  "nixpkgs-unstable",
  "nixos-unstable-small",
  "nixos-unstable",
];

const API = "https://api.github.com/repos/NixOS/nixpkgs";

export type PullRequest = {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  merge_commit_sha: string | null;
  base: { ref: string };
};

export type BranchResult = {
  name: string;
  state: "checking" | "present" | "absent" | "error";
  error?: string;
};

export type TrackerResult = {
  pr: PullRequest;
  branches: BranchResult[];
  checkedAt: string;
};
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function parsePR(input: string): number | undefined {
  const text = input.trim();
  let digits = text.match(/^#?(\d+)$/)?.[1];
  if (!digits) {
    try {
      const url = new URL(text);
      if (url.protocol !== "https:" || url.username || url.password) return;
      if (url.hostname === "github.com") {
        digits = url.pathname.match(
          /^\/NixOS\/nixpkgs\/pull\/(\d+)(?:\/(?:files|commits|checks))?\/?$/i,
        )?.[1];
      } else if (url.hostname === "track.nix.ee" && url.pathname === "/") {
        digits = url.searchParams.get("pr")?.match(/^\d+$/)?.[0];
      }
    } catch {
      return;
    }
  }
  const number = Number(digits);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function getBranches(
  preference: string | undefined,
  target: string,
): string[] {
  const configured = preference?.trim()
    ? preference.split(/[\s,]+/).filter(Boolean)
    : DEFAULT_BRANCHES;
  const branches = [...new Set([...configured, target])];
  if (branches.length > 20)
    throw new Error("Choose at most 19 branches in Extension Preferences.");
  for (const branch of branches) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
      branch.includes("..") ||
      branch.includes("//") ||
      branch.endsWith("/") ||
      branch.endsWith(".") ||
      branch
        .split("/")
        .some((part) => part.startsWith(".") || part.endsWith(".lock"))
    ) {
      throw new Error(
        `Invalid branch name: ${branch}. Check Extension Preferences.`,
      );
    }
  }
  return branches;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export class GitHub {
  constructor(
    private readonly token?: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${API}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "raycast-nixpkgs-tracker",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        "GitHub could not be reached. Check your connection and try again.",
      );
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new GitHubError(
          "GitHub token expired or invalid. Sign in again, or update your token in preferences.",
          401,
        );
      }
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get("x-ratelimit-remaining") === "0" ||
            response.headers.has("retry-after")))
      ) {
        const reset = Number(response.headers.get("x-ratelimit-reset"));
        const when = reset
          ? ` Resets around ${new Date(reset * 1000).toLocaleTimeString()}.`
          : " Try again later.";
        throw new GitHubError(
          `GitHub API rate limit reached.${when}${this.token ? "" : " Sign in to increase the anonymous limit."}`,
          response.status,
        );
      }
      if (response.status === 404) {
        throw new GitHubError("PR, branch or commit not found on GitHub.", 404);
      }
      throw new GitHubError(
        `GitHub returned HTTP ${response.status}. Try again later.`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  async pullRequest(
    number: number,
    signal?: AbortSignal,
  ): Promise<PullRequest> {
    const pr = await this.get<PullRequest>(`/pulls/${number}`, signal);
    if (
      pr.number !== number ||
      typeof pr.title !== "string" ||
      typeof pr.base?.ref !== "string" ||
      !["open", "closed"].includes(pr.state) ||
      !(pr.merged_at === null || typeof pr.merged_at === "string") ||
      !(
        pr.merge_commit_sha === null ||
        /^[a-f0-9]{40}$/.test(pr.merge_commit_sha)
      )
    ) {
      throw new Error(
        "GitHub returned an unexpected PR response. Try again later.",
      );
    }
    return {
      ...pr,
      html_url: `https://github.com/NixOS/nixpkgs/pull/${number}`,
    };
  }

  async contains(
    branch: string,
    mergeCommit: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    // Compare merge commit (base) to branch (head): ahead/identical means the branch contains the commit.
    const result = await this.get<{ status: string }>(
      `/compare/${encodeURIComponent(mergeCommit)}...${encodeURIComponent(branch)}?per_page=1`,
      signal,
    );
    if (!["ahead", "behind", "identical", "diverged"].includes(result.status)) {
      throw new Error("GitHub returned an unexpected comparison response.");
    }
    return result.status === "ahead" || result.status === "identical";
  }
}

export async function checkBranches(
  github: GitHub,
  branches: string[],
  commit: string,
  signal: AbortSignal,
  onResult: (result: BranchResult) => void,
): Promise<void> {
  // Limit simultaneous comparisons to avoid bursting the GitHub API.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, branches.length) }, async () => {
      while (next < branches.length && !signal.aborted) {
        const name = branches[next++];
        try {
          const present = await github.contains(name, commit, signal);
          if (!signal.aborted)
            onResult({ name, state: present ? "present" : "absent" });
        } catch (error) {
          if (signal.aborted) return;
          onResult({
            name,
            state: "error",
            error:
              error instanceof Error ? error.message : "Comparison failed.",
          });
        }
      }
    }),
  );
}
