import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { KeyRound, Trash2 } from "lucide-react";

import {
  changePassword,
  createApiToken,
  getMe,
  listApiTokens,
  revokeApiToken,
} from "@/contexts/access/contract";
import { AppButton } from "@/ui/AppButton";
import { SettingsPasswordForm } from "@/contexts/access/components/SettingsPasswordForm";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { useServerTable } from "@/platform/useServerTable";
import type { User } from "@/contexts/access/types";

export function SettingsTokensSection({
  onError,
  onMessage,
}: {
  onError: (msg: string) => void;
  onMessage: (msg: string) => void;
}) {
  const navigate = useNavigate();
  const [me, setMe] = useState<User | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokenQuery, setTokenQuery] = useState("");

  const tokenTable = useServerTable({
    defaultSort: "createdAt",
    defaultOrder: "desc",
    watchSources: [tokenQuery],
    fetchPage: ({ limit, offset, sort, order }) =>
      listApiTokens({
        limit,
        offset,
        sort,
        order,
        q: tokenQuery || undefined,
      }),
  });

  const load = useCallback(async () => {
    setMe(await getMe());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitPasswordChange() {
    if (newPassword !== confirmPassword) {
      onError("New password and confirmation do not match");
      return;
    }
    if (newPassword.length < 8) {
      onError("New password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onMessage("Password changed — sign in again");
      navigate("/login");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setBusy(false);
    }
  }

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenName.trim()) return;
    setBusy(true);
    setCreatedToken(null);
    try {
      const created = await createApiToken(tokenName.trim());
      setCreatedToken(created.token);
      setTokenName("");
      await tokenTable.load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(id: string) {
    if (!confirm("Revoke this API token?")) return;
    setBusy(true);
    try {
      await revokeApiToken(id);
      await tokenTable.load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to revoke token");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header">Account</div>
        <div className="panel-body">
          <p className="muted mb-5">
            Signed in as <span className="mono">{me?.username ?? "—"}</span>
            {me?.role ? <span className="muted"> ({me.role})</span> : null}. Changing your
            password signs you out; API tokens keep working.
          </p>
          <SettingsPasswordForm
            currentPassword={currentPassword}
            newPassword={newPassword}
            confirmPassword={confirmPassword}
            busy={busy}
            onCurrentPasswordChange={setCurrentPassword}
            onNewPasswordChange={setNewPassword}
            onConfirmPasswordChange={setConfirmPassword}
            onSubmit={() => void submitPasswordChange()}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">Authentication — API tokens</div>
        <div className="panel-body">
          <form className="inline-form" onSubmit={(e) => void createToken(e)}>
            <div className="field">
              <label htmlFor="token-name">Token name</label>
              <Textfield
                id="token-name"
                value={tokenName}
                onChange={(e) => setTokenName(e.currentTarget.value)}
                placeholder="ci-bot"
                isRequired
              />
            </div>
            <AppButton
              variant="primary"
              type="submit"
              loading={busy}
              loadingLabel="Creating…"
              disabled={!tokenName.trim()}
              iconBefore={<KeyRound size={12} />}
            >
              Create token
            </AppButton>
          </form>
          {createdToken ? (
            <div className="alert alert-info mt-5">
              Copy this token now; it will not be shown again.
              <pre className="pre-block mt-3">{createdToken}</pre>
            </div>
          ) : null}
          <div className="inline-form mt-5 task-filters">
            <div className="field flex-2">
              <label htmlFor="token-search">Search</label>
              <Textfield
                id="token-search"
                type="search"
                value={tokenQuery}
                onChange={(e) => setTokenQuery(e.currentTarget.value)}
                placeholder="Token name…"
              />
            </div>
          </div>
          {tokenTable.total === 0 ? (
            <div className="muted mt-5">
              {tokenQuery.trim() ? "No tokens match these filters" : "No tokens"}
            </div>
          ) : (
            <>
              <div className="table-wrap mt-5">
                <table className="data">
                  <thead>
                    <tr>
                      <SortableTh
                        column="name"
                        label="Name"
                        sort={tokenTable.sort}
                        order={tokenTable.order}
                        onSort={tokenTable.setSort}
                      />
                      <SortableTh
                        column="createdAt"
                        label="Created"
                        sort={tokenTable.sort}
                        order={tokenTable.order}
                        defaultOrder="desc"
                        onSort={tokenTable.setSort}
                      />
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tokenTable.items.map((token) => (
                      <tr key={token.id}>
                        <td>{token.name}</td>
                        <td className="mono muted">
                          {new Date(token.createdAt).toLocaleString()}
                        </td>
                        <td>
                          <AppButton
                            variant="danger"
                            size="sm"
                            loading={busy}
                            loadingLabel="Working…"
                            onClick={() => void revokeToken(token.id)}
                            iconBefore={<Trash2 size={12} />}
                          >
                            Revoke
                          </AppButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePager
                page={tokenTable.page}
                pageCount={tokenTable.pages}
                rangeLabel={tokenTable.rangeLabel}
                total={tokenTable.total}
                onPageChange={tokenTable.setPage}
                loading={tokenTable.loading}
              />
            </>
          )}
        </div>
      </section>
    </>
  );
}
