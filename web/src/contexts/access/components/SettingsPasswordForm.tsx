import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { ShieldCheck } from "lucide-react";

import { AppButton } from "@/ui/AppButton";

export type SettingsPasswordFormProps = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  busy: boolean;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: () => void;
};

export function SettingsPasswordForm({
  currentPassword,
  newPassword,
  confirmPassword,
  busy,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
}: SettingsPasswordFormProps) {
  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="field">
        <label htmlFor="current-password">Current password</label>
        <Textfield
          id="current-password"
          type="password"
          autoComplete="current-password"
          isRequired
          value={currentPassword}
          onChange={(e) => onCurrentPasswordChange(e.currentTarget.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <Textfield
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          isRequired
          value={newPassword}
          onChange={(e) => onNewPasswordChange(e.currentTarget.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="confirm-password">Confirm new password</label>
        <Textfield
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          isRequired
          value={confirmPassword}
          onChange={(e) => onConfirmPasswordChange(e.currentTarget.value)}
        />
      </div>
      <AppButton
        variant="primary"
        type="submit"
        loading={busy}
        loadingLabel="Saving…"
        disabled={!currentPassword || !newPassword || !confirmPassword}
        iconBefore={<ShieldCheck size={12} />}
      >
        Change password
      </AppButton>
    </form>
  );
}
