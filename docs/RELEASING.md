# Automatic releases

The primary branch is `main`. Every push to it queues **Check and release**.

1. The read-only check job installs Nix and runs
   `nix develop --no-update-lock-file --command npm run check`.
2. Its tested `nixpkgs-tracker.rayext` is stored as a workflow artifact.
3. A separate release job receives that exact artifact, fetches current tags,
   and runs `scripts/release.mjs --publish` in the same devShell.
4. The release script creates an annotated tag for the tested push SHA, creates
   a draft GitHub Release, uploads the bundle, then publishes the draft.

Only the release job has `contents: write`. Publishing uses the ephemeral
`GITHUB_TOKEN`; no PAT, personal GPG key or additional repository secret is needed.
Automatic annotated tags are created by GitHub Actions and are not signed with
the maintainer's Personal ED key. Maintainer commits can still be signed locally.
No version-bump commit is pushed back into `main`.

## Version policy

The stable `vMAJOR.MINOR.PATCH` Git tags are the source of release versions.
`package.json` is a Raycast extension manifest and does not need a manually bumped
version field. Prerelease and non-SemVer tags are ignored by this policy.

All commit messages since the most recent stable tag are considered:

- `feat:` and `feat(scope):` request a minor increment.
- `type!:` or `type(scope)!:` request a major increment, as does a
  `BREAKING CHANGE:` or `BREAKING-CHANGE:` footer.
- Everything else requests a patch, including documentation and CI-only pushes.

The largest requested increment wins; lower components reset to zero. Breaking
changes also increment the major version while on `0.x`: `v0.1.0` becomes `v1.0.0`.
If no stable tags exist, the policy starts from `v0.0.0`.
Use Conventional Commit wording in squash commit titles when merging PRs.

Inspect the next plan for the local **committed** history without publishing:

```sh
git fetch --tags
nix develop --command npm run release:plan
```

## Queueing, retries and recovery

Push workflows use a serialized GitHub concurrency group with `queue: max`.
This avoids racing to allocate a version or canceling an already-started release.
If a delayed older commit is no longer a descendant of the newest version tag,
the release script skips it to avoid publishing a version of superseded code.
Branch history should advance without force-pushing across released commits.

An existing stable tag on the same SHA is reused. Existing published assets are
never overwritten. If a run stops after creating a tag or draft, re-run the failed
jobs in that push's workflow: the same release is completed. An upload failure
leaves a draft rather than publishing an empty release.

Workflow artifacts are retained for seven days. If the artifact has expired,
re-run all jobs in the original push workflow to rebuild it. A new manual
`workflow_dispatch` run only checks code; it does not publish.

The workflow queues at most 100 pending runs, GitHub's queue limit.
Pinned actionlint does not recognize GitHub's newer `queue` property yet;
`.github/actionlint.yaml` ignores only that specific diagnostic in this workflow.
All other workflow validation remains enabled.
