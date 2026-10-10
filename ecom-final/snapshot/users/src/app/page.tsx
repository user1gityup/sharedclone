import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>users — identity service</h1>
      <p>
        Identity, authentication and session for the ecommerce platform. Sessions
        are signed with EdDSA/Ed25519 and verified by storefronts against the
        public JWKS.
      </p>
      <nav>
        <Link href="/login">Sign in</Link>
        <Link href="/signup">Create account</Link>
        <Link href="/forgot-password">Forgot password</Link>
        <Link href="/profile">Profile</Link>
        <Link href="/.well-known/jwks.json">JWKS</Link>
      </nav>
    </main>
  );
}
