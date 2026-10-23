<p align="center">
  <img src="assets/nixpkgs-tracker.png" width="96" height="96" alt="NixPkgs PR Tracker icon" />
</p>

<h1 align="center">NixPkgs PR Tracker</h1>

<p align="center">Merged is only the beginning. See which branches your Nixpkgs PR has reached — right from Raycast.</p>

<p align="center">
  <a href="https://github.com/kontsevoye/raycast-nixpkgs-tracker/actions/workflows/ci.yml"><img src="https://github.com/kontsevoye/raycast-nixpkgs-tracker/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/kontsevoye/raycast-nixpkgs-tracker/releases"><img src="https://img.shields.io/github/v/release/kontsevoye/raycast-nixpkgs-tracker?color=5277c3" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/code-MIT-39c58e" alt="MIT license" /></a>
</p>

<p align="center">
  <img src="docs/screenshots/branch-status.png" width="900" alt="Raycast showing a Nixpkgs PR and the branches that contain its merge commit" />
</p>

## Features

- **Follow a PR through Nixpkgs:** staging, staging-next, master and your selected channel branches.
- **Paste a number or URL:** accepts `576853`, `#576853`, GitHub PR links and `track.nix.ee` links.
- **Sign in with GitHub:** browser authorization, secure token storage and automatic session restoration. No token copying required.
- **Bring your own token:** an optional password preference is available instead of browser sign-in.
- **Return to recent PRs:** locally saved history with fresh checks whenever you reopen a PR.
- **See what happened:** reached, not reached and failed checks are distinct states.
- **Choose your branches:** customize the list in preferences; the PR's target branch is included automatically.

Requests go directly to the GitHub API. No tracker account or self-hosted service is needed.

## Installation

Requires macOS, a recent version of [Raycast](https://www.raycast.com/), Node.js 22 or later, and npm.

```sh
git clone https://github.com/kontsevoye/raycast-nixpkgs-tracker.git
cd raycast-nixpkgs-tracker
npm ci
npm run dev
```

The official Raycast CLI imports the extension. Once the build is ready, stop the
watcher with `Ctrl+C`; the command remains installed. Search for **Track NixPkgs PR**
in Raycast to use it.

Prebuilt `.rayext` bundles are also available in [Releases](https://github.com/kontsevoye/raycast-nixpkgs-tracker/releases).

## Usage

1. Open **Track NixPkgs PR** in Raycast.
2. Enter a PR number or paste a link, then press Return.
3. Check the branch list. Press **⌘R** to refresh.

Use **⌘K** for actions: open the PR or a branch on GitHub, copy links, show
details, sign in, or open extension preferences.

The default refs are `staging`, `staging-next`, `master`, `nixpkgs-unstable`,
`nixos-unstable-small` and `nixos-unstable`. For macOS users,
`nixpkgs-unstable` is often the channel of interest. Add release refs such as
`nixos-26.05` or `release-26.05` in **Branches to Check**.

The screenshot is a native macOS window capture with transparent edges and the original window shadow. It shows real API results at capture time; branch statuses change as updates propagate.

## GitHub sign-in

Select the GitHub row and choose **Sign in with GitHub**. Complete authorization
in your browser and return to Raycast. Raycast stores the tokens securely and
restores the session next time you open the command. Expiring sessions with a
refresh token are refreshed through Raycast's OAuth service.

The extension requests **no additional OAuth scopes**: reading public Nixpkgs
data is enough. Raycast uses a shared OAuth app, so GitHub may display permissions
you previously granted to that app. You can sign out from the extension or revoke
the upstream authorization in your GitHub application settings.

Alternatively, enter a token in **GitHub Personal Access Token** in preferences.
That token takes precedence over browser sign-in until you clear it. Anonymous
use also works, with GitHub's lower request limit. Signing in increases the API
allowance; it does not guarantee faster individual requests.

## How the checks work

The extension reads the PR's merge commit, then compares that commit with each
selected branch using GitHub's REST API. Checks run with at most three requests
in parallel. An `ahead` or `identical` comparison means the branch contains the
merge commit; `behind` or `diverged` means it does not.

Open and closed-but-unmerged PRs are shown without branch comparisons. Network,
authentication, missing-ref and rate-limit failures are shown as errors.

Backports and cherry-picks have different commits: track the backport PR separately.
Branch presence also does not prove that a particular package builds or is in a
binary cache. Checks run on demand; background polling and notifications are not included.

## Development

```sh
npm test
npm run build
npm run typecheck
npm run lint
npm run bundle
```

`npm run bundle` creates `nixpkgs-tracker.rayext`. To regenerate the icon, install
ImageMagick with librsvg support and run `python3 scripts/make-icon.py`.

`npm run lint:store` additionally validates Raycast Store metadata, including a
registered Raycast author username. Local installation does not require a Store account.

## Credits and license

Inspired by [ocfox/nixpkgs-tracker](https://github.com/ocfox/nixpkgs-tracker) and its
direct GitHub API approach. The Raycast implementation is developed independently.

Code is licensed under [MIT](LICENSE). The icon adapts the official **Nix Snowflake**
by Simon Frankau and Tim Cuthbertson, with a dark background and a green pull
request badge. Logo assets are licensed under **CC BY 4.0**; see
[attribution and source details](ATTRIBUTION.md). This is an independent community
extension.
