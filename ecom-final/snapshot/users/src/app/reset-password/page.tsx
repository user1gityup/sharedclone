"use client";

import { useState, type FormEvent } from "react";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);

    const res = await fetch("/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });

    if (res.status === 204) {
      setMessage("Password reset. You can now sign in.");
    } else {
      const data = await res.json().catch(() => null);
      setError(true);
      setMessage(data?.error_description ?? data?.error ?? "Reset failed.");
    }
    setBusy(false);
  }

  return (
    <main>
      <h1>Reset password</h1>
      <form onSubmit={submit}>
        <label>
          Reset token
          <input value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={12}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Resetting…" : "Reset password"}
        </button>
      </form>
      {message ? <div className={error ? "message error" : "message"}>{message}</div> : null}
    </main>
  );
}
