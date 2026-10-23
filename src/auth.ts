import { getPreferenceValues } from "@raycast/api";
import { OAuthService } from "@raycast/utils";

// Public NixPkgs reads need no OAuth scopes. Raycast manages the app, PKCE and secure token storage.
export const githubOAuth = OAuthService.github({
  scope: "",
  description:
    "Sign in to increase the GitHub API limit for NixPkgs PR tracking.",
});

export type Auth = {
  token?: string;
  source: "anonymous" | "oauth" | "personal";
};

export function personalToken(): string | undefined {
  return (
    getPreferenceValues<{ githubToken?: string }>().githubToken?.trim() ||
    undefined
  );
}

export async function loadAuth(): Promise<Auth> {
  const token = personalToken();
  if (token) return { token, source: "personal" };
  const stored = await githubOAuth.client.getTokens();
  if (!stored?.accessToken) return { source: "anonymous" };
  if (!stored.isExpired())
    return { token: stored.accessToken, source: "oauth" };
  if (stored.refreshToken)
    return { token: await githubOAuth.authorize(), source: "oauth" };
  return { source: "anonymous" };
}
