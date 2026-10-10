"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);

    const res = await fetch("/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => null);

    if (res.ok) {
      setMessage(
        "Signed in. Access token: " +
          (data?.tokens?.accessToken ?? "").slice(0, 32) +
          "…",
      );
    } else if (data?.challengeToken) {
      setMessage("Two-factor required. Challenge token: " + data.challengeToken);
    } else {
      setError(true);
      setMessage(data?.error ?? "Sign-in failed.");
    }
    setBusy(false);
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {message ? <div className={error ? "message error" : "message"}>{message}</div> : null}
    </main>
  );
}
