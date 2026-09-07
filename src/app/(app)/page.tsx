import { redirect } from "next/navigation";

export default function HomePage() {
  // ponytail: /batches is not built yet (plan Task 8), so land on Inbox.
  // Restore `redirect("/batches")` the moment that route exists.
  redirect("/inbox");
}
