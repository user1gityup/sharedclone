export const dynamic = "force-dynamic";

// Search page — reads ?q= and ?category= from the URL.
export default function SearchPage({ searchParams }: { searchParams: { q?: string; category?: string } }) {
  const q = searchParams.q || "";
  const category = searchParams.category || "";

  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "16px" }}>Search Products</h1>
      <form method="get" style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="Search products..."
          style={{ flex: 1, padding: "10px 16px", borderRadius: "8px", border: "1px solid #ddd", fontSize: "1rem" }}
        />
        {category && <input type="hidden" name="category" value={category} />}
        <button type="submit" style={{ padding: "10px 24px", background: "#1a1a2e", color: "white", border: "none", borderRadius: "8px", fontSize: "1rem", cursor: "pointer" }}>
          Search
        </button>
      </form>
      {q && <p style={{ color: "#888", marginBottom: "16px" }}>Results for &quot;{q}&quot;{category ? ` in ${category}` : ""}</p>}
      {!q && !category && <p style={{ color: "#888" }}>Type a query to search the catalog.</p>}
    </div>
  );
}