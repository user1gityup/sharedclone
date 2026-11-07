"use client";

import { useState, type FormEvent } from "react";

export default function ProfilePage() {
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);
    setProfile(null);

    const res = await fetch("/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => null);

    if (res.ok) {
      setProfile(data);
    } else {
      setError(true);
      setMessage(data?.error_description ?? data?.error ?? "Request failed.");
    }
    setBusy(false);
  }

  return (
    <main>
      <h1>Profile</h1>
      <form onSubmit={submit}>
        <label>
          Access token
          <input value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Loading…" : "Load profile"}
        </button>
      </form>
      {message ? <div className={error ? "message error" : "message"}>{message}</div> : null}
      {profile ? <pre>{JSON.stringify(profile, null, 2)}</pre> : null}
    </main>
  );
}
