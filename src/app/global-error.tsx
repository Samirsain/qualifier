"use client";

/** Last-resort boundary: catches failures in the root layout itself. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.75rem", fontWeight: 600 }}>
          The application could not start
        </h1>
        <p style={{ maxWidth: "28rem", color: "#555" }}>
          Please tell an administrator. Nothing has been sent or changed.
        </p>
        {error.digest && (
          <p style={{ fontSize: "0.8125rem", color: "#666" }}>
            Reference for support: <code>{error.digest}</code>
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{ padding: "0.5rem 0.75rem", borderRadius: 4, cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
