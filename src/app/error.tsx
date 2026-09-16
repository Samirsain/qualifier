"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui";

/**
 * Operational error state (doc 04 "Error state": human-readable error, retry
 * where safe, correlation/reference ID for support).
 *
 * `digest` is the id Next.js also writes to the server log for this exact
 * error, so a user can quote it and an operator can find the stack trace —
 * without the message itself leaking internals to the browser.
 *
 * Reload is its own button because "Try again" cannot fix the commonest cause:
 * a tab left open across a deploy submits a form whose Server Action id no
 * longer exists in the running build, and re-rendering resubmits the same dead
 * id. Only fetching the new page helps.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] render failed", { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-[length:var(--text-h1)] font-semibold">
        Something went wrong
      </h1>
      <p className="max-w-md text-[color:var(--color-text-secondary)]">
        This screen could not be loaded. Nothing you were working on has been
        sent or changed. If this tab has been open a while, reload it — a newer
        version may have been deployed since.
      </p>
      {error.digest && (
        <p className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          Reference for support:{" "}
          <code className="font-[family-name:var(--font-mono)]">{error.digest}</code>
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={reset} className={buttonClass.primary}>
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={buttonClass.secondary}
        >
          Reload the page
        </button>
        <Link href="/" className={buttonClass.secondary}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
