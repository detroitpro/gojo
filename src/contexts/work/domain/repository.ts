export interface RepositoryIdentity {
  adapter: "github" | "gitlab" | "forgejo";
  host: string;
  externalKey: string;
  webUrl: string;
  cloneUrl: string;
}

function inferAdapter(host: string): RepositoryIdentity["adapter"] {
  if (host.toLowerCase() === "github.com") return "github";
  if (host.toLowerCase() === "gitlab.com" || host.toLowerCase().includes("gitlab")) {
    return "gitlab";
  }
  return "forgejo";
}

export function parseRepositoryRemote(
  remote: string,
  adapterHint?: RepositoryIdentity["adapter"],
): RepositoryIdentity {
  const value = remote.trim();
  if (!value) throw new Error("Repository remote is empty");

  let host: string;
  let pathname: string;
  const scp = value.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (scp && !value.includes("://")) {
    host = scp[1] ?? "";
    pathname = scp[2] ?? "";
  } else {
    const url = new URL(value);
    host = url.hostname;
    pathname = url.pathname;
  }

  const externalKey = pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (!host || !externalKey || !externalKey.includes("/")) {
    throw new Error(`Unsupported repository remote: ${remote}`);
  }

  const adapter = adapterHint ?? inferAdapter(host);
  return {
    adapter,
    host,
    externalKey,
    webUrl: `https://${host}/${externalKey}`,
    cloneUrl: value,
  };
}

export function providerBaseUrl(identity: RepositoryIdentity): string {
  if (identity.adapter === "github" && identity.host === "github.com") {
    return "https://api.github.com";
  }
  if (identity.adapter === "gitlab") {
    return `https://${identity.host}/api/v4`;
  }
  return `https://${identity.host}`;
}
