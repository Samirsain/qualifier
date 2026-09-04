import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-[length:var(--text-h1)] font-semibold">Not found</h1>
      <p className="max-w-md text-[color:var(--color-text-secondary)]">
        This record does not exist, or it is outside the customers you have
        access to.
      </p>
      <Link href="/" className={buttonClass.secondary}>
        Back to dashboard
      </Link>
    </div>
  );
}
