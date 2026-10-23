import {
  Action,
  ActionPanel,
  Color,
  getPreferenceValues,
  Icon,
  Keyboard,
  LaunchProps,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { Auth, githubOAuth, loadAuth, personalToken } from "./auth";
import {
  BranchResult,
  checkBranches,
  getBranches,
  GitHub,
  parsePR,
  TrackerResult,
} from "./lib/github";

type Recent = { number: number; title: string };
type Arguments = { pr?: string };
const EMPTY_RECENT: Recent[] = [];
const authLabels = {
  anonymous: "Not signed in",
  oauth: "Signed in with GitHub",
  personal: "Personal access token",
};
const states = {
  checking: {
    title: "Checking…",
    icon: Icon.Clock,
    color: Color.SecondaryText,
  },
  present: { title: "Reached", icon: Icon.CheckCircle, color: Color.Green },
  absent: {
    title: "Not reached",
    icon: Icon.Circle,
    color: Color.SecondaryText,
  },
  error: {
    title: "Could not check",
    icon: Icon.ExclamationMark,
    color: Color.Orange,
  },
};

export default function TrackPR(props: LaunchProps<{ arguments: Arguments }>) {
  const initialInput = props.arguments.pr ?? "";
  const [input, setInput] = useState(initialInput);
  const [number, setNumber] = useState<number | undefined>(() =>
    parsePR(initialInput),
  );
  const [auth, setAuth] = useState<Auth>({ source: "anonymous" });
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TrackerResult>();
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [recent, setRecent] = useCachedState<Recent[]>(
    "recent-prs",
    EMPTY_RECENT,
  );
  const abortRef = useRef<AbortController | null>(null);
  const branchesPreference = getPreferenceValues<{ branches?: string }>()
    .branches;
  const candidate = parsePR(input);

  useEffect(() => {
    let active = true;
    loadAuth()
      .then((value) => {
        if (active) setAuth(value);
      })
      .catch(() => {
        if (active) {
          void showToast({
            style: Toast.Style.Failure,
            title: "Could not restore GitHub sign-in",
            message: "Sign in again from Actions (⌘K).",
          });
        }
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authReady || !number) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    const github = new GitHub(auth.token);
    async function track() {
      try {
        const pr = await github.pullRequest(number!, controller.signal);
        if (controller.signal.aborted) return;
        setRecent((previous) =>
          [
            { number: pr.number, title: pr.title },
            ...previous.filter((item) => item.number !== pr.number),
          ].slice(0, 12),
        );
        const names =
          pr.merged_at && pr.merge_commit_sha
            ? getBranches(branchesPreference, pr.base.ref)
            : [];
        const branches: BranchResult[] = names.map((name) => ({
          name,
          state: "checking",
        }));
        setResult({ pr, branches, checkedAt: new Date().toISOString() });
        if (!pr.merged_at) return;
        if (!pr.merge_commit_sha)
          throw new Error(
            "PR is merged, but GitHub has not returned its merge commit yet. Try refreshing shortly.",
          );
        await checkBranches(
          github,
          names,
          pr.merge_commit_sha,
          controller.signal,
          (update) => {
            setResult(
              (current) =>
                current && {
                  ...current,
                  branches: current.branches.map((branch) =>
                    branch.name === update.name ? update : branch,
                  ),
                },
            );
          },
        );
        if (!controller.signal.aborted)
          setResult(
            (current) =>
              current && { ...current, checkedAt: new Date().toISOString() },
          );
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not check this PR.",
          );
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void track();
    return () => controller.abort();
  }, [number, auth.token, authReady, refresh, branchesPreference, setRecent]);

  function selectPR(value: number) {
    abortRef.current?.abort();
    setInput(String(value));
    setNumber(value);
    setRefresh((count) => count + 1);
  }

  function changeInput(value: string) {
    // Raycast also reports controlled text changes made when opening a recent PR.
    if (value === input) return;
    abortRef.current?.abort();
    setInput(value);
    setNumber(undefined);
    setResult(undefined);
    setError(undefined);
    setBusy(false);
  }

  async function signIn() {
    setAuthBusy(true);
    try {
      // Explicitly reconnect, including when a stored token has been revoked upstream.
      await githubOAuth.client.removeTokens();
      const token = await githubOAuth.authorize();
      setAuth({ token, source: "oauth" });
      setRefresh((count) => count + 1);
      await showToast({
        style: Toast.Style.Success,
        title: "Signed in with GitHub",
      });
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: "GitHub sign-in was not completed",
        message: "Try again, or use a token in Extension Preferences.",
      });
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    await githubOAuth.client.removeTokens();
    const token = personalToken();
    setAuth(token ? { token, source: "personal" } : { source: "anonymous" });
    setRefresh((count) => count + 1);
    await showToast({
      style: Toast.Style.Success,
      title: "Signed out of this extension",
    });
  }

  function CommonActions() {
    return (
      <ActionPanel.Section title="NixPkgs PR Tracker">
        {result && (
          <Action
            title={showDetails ? "Hide Details" : "Show Details"}
            icon={Icon.Text}
            onAction={() => setShowDetails((value) => !value)}
          />
        )}
        {auth.source === "anonymous" && (
          <Action
            title={authBusy ? "Signing in…" : "Sign in with GitHub"}
            icon={Icon.Person}
            onAction={() => {
              if (!authBusy) void signIn();
            }}
          />
        )}
        {auth.source === "oauth" && (
          <Action
            title="Sign out of GitHub"
            icon={Icon.Logout}
            onAction={signOut}
          />
        )}
        {number && (
          <Action
            title="Refresh Status"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={() => setRefresh((count) => count + 1)}
          />
        )}
        <Action
          title="Extension Preferences"
          icon={Icon.Gear}
          onAction={openExtensionPreferences}
        />
        {recent.length > 0 && (
          <Action
            title="Clear Recent PRs"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={() => setRecent([])}
          />
        )}
      </ActionPanel.Section>
    );
  }

  const pr = result?.pr;
  const prStatus = pr?.merged_at
    ? "Merged"
    : pr?.state === "closed"
      ? "Closed without merging"
      : "Open · not merged yet";
  const summary = pr
    ? `# #${pr.number}\n\n${pr.title}\n\n**${prStatus}** → \`${pr.base.ref}\`\n\n${pr.merged_at ? `Merged ${new Date(pr.merged_at).toLocaleString()}.` : "Branch checks start after the PR is merged."}\n\n[GitHub](${pr.html_url}) · [NixPkgs Tracker](https://track.nix.ee/?pr=${pr.number})`
    : "";
  const checkedAt = result
    ? new Date(result.checkedAt).toLocaleTimeString()
    : "";

  return (
    <List
      isLoading={!authReady || busy || authBusy}
      filtering={false}
      searchText={input}
      onSearchTextChange={changeInput}
      searchBarPlaceholder="PR number, GitHub URL or track.nix.ee URL…"
      navigationTitle="NixPkgs PR Tracker"
      isShowingDetail={showDetails || Boolean(error)}
    >
      {!number && input.trim() && (
        <List.Item
          title={
            candidate
              ? `Track NixPkgs PR #${candidate}`
              : "Enter a NixPkgs PR number or URL"
          }
          subtitle={
            candidate
              ? "Press ↵ to check branches"
              : "Example: 576853 or https://github.com/NixOS/nixpkgs/pull/576853"
          }
          icon={candidate ? Icon.MagnifyingGlass : Icon.QuestionMarkCircle}
          actions={
            <ActionPanel>
              {candidate && (
                <Action
                  title="Track PR"
                  icon={Icon.MagnifyingGlass}
                  onAction={() => selectPR(candidate)}
                />
              )}
              <CommonActions />
            </ActionPanel>
          }
        />
      )}
      {error && (
        <List.Item
          title="Could not track PR"
          subtitle={error}
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Red }}
          detail={
            <List.Item.Detail markdown={`# Could not check PR\n\n${error}`} />
          }
          actions={
            <ActionPanel>
              {auth.source !== "personal" ? (
                <Action
                  title={
                    auth.source === "oauth"
                      ? "Reconnect GitHub"
                      : "Sign in with GitHub"
                  }
                  icon={Icon.Person}
                  onAction={() => {
                    if (!authBusy) void signIn();
                  }}
                />
              ) : (
                <Action
                  title="Manage GitHub Token"
                  icon={Icon.Gear}
                  onAction={openExtensionPreferences}
                />
              )}
              <CommonActions />
            </ActionPanel>
          }
        />
      )}
      {pr && (
        <List.Section
          title={`PR #${pr.number}`}
          subtitle={busy ? "Checking branches…" : `Checked ${checkedAt}`}
        >
          <List.Item
            title={pr.title}
            subtitle={prStatus}
            icon={{
              source: pr.merged_at ? Icon.CheckCircle : Icon.Circle,
              tintColor: pr.merged_at ? Color.Purple : Color.Orange,
            }}
            detail={<List.Item.Detail markdown={summary} />}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser
                  title="Open PR on GitHub"
                  url={pr.html_url}
                />
                <Action.OpenInBrowser
                  title="Open NixPkgs Tracker"
                  url={`https://track.nix.ee/?pr=${pr.number}`}
                />
                <Action.CopyToClipboard
                  title="Copy PR URL"
                  content={pr.html_url}
                />
                <CommonActions />
              </ActionPanel>
            }
          />
          {result.branches.map((branch) => {
            const state = states[branch.state];
            const branchUrl = `https://github.com/NixOS/nixpkgs/tree/${encodeURIComponent(branch.name)}`;
            return (
              <List.Item
                key={branch.name}
                title={branch.name}
                subtitle={branch.name === pr.base.ref ? "PR target" : undefined}
                icon={{ source: state.icon, tintColor: state.color }}
                accessories={[
                  {
                    tag: { value: state.title, color: state.color },
                    tooltip: branch.error ?? state.title,
                  },
                ]}
                detail={
                  <List.Item.Detail
                    markdown={`${summary}\n\n---\n\n## ${branch.name}\n\n**${state.title}**${branch.error ? `\n\n${branch.error}` : ""}\n\n${branch.state === "present" ? "This branch contains the PR's merge commit." : branch.state === "absent" ? "The PR's merge commit is not in this branch. Backports and cherry-picks have separate commits and PRs." : ""}`}
                  />
                }
                actions={
                  <ActionPanel>
                    <Action.OpenInBrowser
                      title="Open Branch on GitHub"
                      url={branchUrl}
                    />
                    <Action.OpenInBrowser
                      title="Open PR on GitHub"
                      url={pr.html_url}
                    />
                    <Action.OpenInBrowser
                      title="Open NixPkgs Tracker"
                      url={`https://track.nix.ee/?pr=${pr.number}`}
                    />
                    <Action.CopyToClipboard
                      title="Copy Branch Name"
                      content={branch.name}
                    />
                    <CommonActions />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}
      {!number && recent.length > 0 && (
        <List.Section title="Recent PRs">
          {recent
            .filter(
              (item) =>
                !input.trim() ||
                `${item.number} ${item.title}`
                  .toLowerCase()
                  .includes(input.toLowerCase()),
            )
            .map((item) => (
              <List.Item
                key={item.number}
                title={`#${item.number}`}
                subtitle={item.title}
                icon={Icon.Clock}
                actions={
                  <ActionPanel>
                    <Action
                      title="Track PR"
                      icon={Icon.MagnifyingGlass}
                      onAction={() => selectPR(item.number)}
                    />
                    <CommonActions />
                  </ActionPanel>
                }
              />
            ))}
        </List.Section>
      )}
      <List.Section title="GitHub">
        <List.Item
          title={authLabels[auth.source]}
          icon={auth.source === "anonymous" ? Icon.Person : Icon.PersonCircle}
          subtitle={
            auth.source === "anonymous"
              ? "Sign in for a higher API limit"
              : auth.source === "personal"
                ? "Manage token in Extension Preferences"
                : "Token saved securely by Raycast"
          }
          detail={
            pr ? (
              <List.Item.Detail
                markdown={`# GitHub\n\n${authLabels[auth.source]}\n\n${auth.source === "personal" ? "The optional token in Extension Preferences takes precedence over GitHub sign-in." : "Sign in with GitHub to raise the API limit. Raycast stores the token securely. This extension requests public read access only."}`}
              />
            ) : undefined
          }
          actions={
            <ActionPanel>
              {auth.source !== "personal" ? (
                <Action
                  title={
                    auth.source === "oauth"
                      ? "Reconnect GitHub"
                      : "Sign in with GitHub"
                  }
                  icon={Icon.Person}
                  onAction={() => {
                    if (!authBusy) void signIn();
                  }}
                />
              ) : (
                <Action
                  title="Manage GitHub Token"
                  icon={Icon.Gear}
                  onAction={openExtensionPreferences}
                />
              )}
              <CommonActions />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}
