import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-[length:var(--text-h1)] font-semibold">
        You cannot access this
      </h1>
      <p className="max-w-md text-[color:var(--color-text-secondary)]">
        Your role does not include this module. Ask an administrator if you need
        access.
      </p>
      <Link href="/" className={buttonClass.secondary}>
        Back to dashboard
      </Link>
    </div>
  );
}
