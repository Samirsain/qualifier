import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { currentUser } from "@/lib/session";
import { buttonClass, ErrorNote, Field, inputClass } from "@/components/ui";

/** UI-001 — Login. Centered auth card, credential form, error + loading. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;

  async function authenticate(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? "").trim(),
        password: String(formData.get("password") ?? ""),
        redirectTo: "/",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        /*
         * Security §8 — generic message outside, detailed diagnostics inside.
         *
         * `CredentialsSignin` is a genuine bad email or password. Any other
         * AuthError means the sign-in path itself failed (most often the
         * database being unreachable), and showing "incorrect password" for
         * that would send an operator hunting the wrong problem.
         */
        if (err.type === "CredentialsSignin") {
          redirect("/login?error=invalid");
        }
        console.error("[auth] sign-in failed", { type: err.type, cause: err.cause });
        redirect("/login?error=unavailable");
      }
      throw err;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] p-6 shadow-[var(--shadow-surface)]">
        <h1 className="text-[length:var(--text-h2)] font-semibold">3% Club</h1>
        <p className="mt-1 mb-6 text-[color:var(--color-text-secondary)]">
          Sign in to the customer dashboard.
        </p>

        {error === "invalid" && <ErrorNote>Incorrect email or password.</ErrorNote>}
        {error === "unavailable" && (
          <ErrorNote>
            Sign-in is temporarily unavailable. This is not your password — ask
            an administrator to check the server logs.
          </ErrorNote>
        )}

        <form action={authenticate} className="mt-4 flex flex-col gap-4">
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              name="email"
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <button type="submit" className={buttonClass.primary}>
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
