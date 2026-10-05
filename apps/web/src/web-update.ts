/** A build identifier catches redeployments even when the package version stays the same. */
export async function hasNewWebBuild(
  currentBuildId: string,
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    return typeof data === 'object' && data !== null && 'buildId' in data &&
      typeof data.buildId === 'string' && data.buildId.length > 0 && data.buildId !== currentBuildId;
  } catch {
    // Offline, older servers and proxy error pages must not cause refresh loops.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function webRefreshUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set('baker-refresh', String(Date.now()));
  return url.href;
}
