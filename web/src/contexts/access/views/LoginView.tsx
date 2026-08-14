import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { KeyRound as KeyIcon } from "lucide-react";

import { checkSession, login, probeSetupNeeded, setup } from "@/contexts/access/contract";
import { getHealth } from "@/contexts/operations/contract";
import { AppButton } from "@/ui/AppButton";
import { AppSectionMessage } from "@/ui/AppSectionMessage";
import { AppSpinner } from "@/ui/AppSpinner";
import { ApiError } from "@/infrastructure/api-error";

export function LoginView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"loading" | "setup" | "login">("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const health = await getHealth();
        setVersion(health.version);
        const session = await checkSession({ force: true });
        if (session) {
          const redirect = params.get("redirect") || "/";
          void navigate(redirect, { replace: true });
          return;
        }
        const needsSetup = await probeSetupNeeded();
        setMode(needsSetup ? "setup" : "login");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to reach API");
        setMode("login");
      }
    })();
  }, [navigate, params]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "setup") {
        await setup(username.trim(), password);
      } else {
        await login(username.trim(), password);
      }
      const redirect = params.get("redirect") || "/";
      void navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1>gojo</h1>
        {mode === "setup" ? (
          <p className="auth-purpose">
            Create the admin account to finish setting up this instance.
          </p>
        ) : mode === "login" ? (
          <p className="auth-purpose">
            Scheduled agent orchestration — sign in to the ops console.
          </p>
        ) : (
          <p className="auth-purpose">Connecting…</p>
        )}

        {version ? <div className="mono muted text-sm mb-6">v{version}</div> : null}

        {error ? <AppSectionMessage appearance="error">{error}</AppSectionMessage> : null}

        {mode === "loading" ? (
          <AppSpinner size="large" />
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <div className="field">
              <label htmlFor="username">Username</label>
              <Textfield
                id="username"
                name="username"
                autoComplete="username"
                isRequired
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <Textfield
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                isRequired
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
            <AppButton
              variant="primary"
              className="w-full"
              type="submit"
              loading={busy}
              loadingLabel={mode === "setup" ? "Completing setup…" : "Signing in…"}
              iconBefore={<KeyIcon size={14} />}
            >
              {mode === "setup" ? "Complete setup" : "Sign in"}
            </AppButton>
          </form>
        )}
      </div>
    </div>
  );
}
