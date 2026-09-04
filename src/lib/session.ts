import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can, type Permission, type RoleCode } from "@/lib/rbac";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  roles: RoleCode[];
};

/**
 * The signed-in user, re-checked against the database on every request.
 *
 * Sessions are JWTs, so the token alone would keep working after an account is
 * disabled or its roles change. Doc 11 §7 requires sessions to be revoked for
 * disabled users, and §3 requires roles to be authoritative server-side — so
 * status and roles are read live rather than trusted from the token.
 *
 * ponytail: one indexed lookup per request. If that ever shows up in a
 * profile, cache it per-request or short-TTL — do not drop the check.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      userRoles: { select: { role: { select: { code: true } } } },
    },
  });

  // Deleted or no longer active: the token is valid but the account is not.
  if (!account || account.status !== "ACTIVE") return null;

  return {
    id: account.id,
    name: account.displayName,
    email: account.email,
    // Live roles, so a revoked role takes effect immediately rather than at
    // the next sign-in.
    roles: account.userRoles.map((ur) => ur.role.code as RoleCode),
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Server-side authorization is authoritative (Security §1). Every page and
 * server action that touches a module calls this, not just the nav.
 */
export async function requirePermission(
  permission: Permission,
): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.roles, permission)) redirect("/forbidden");
  return user;
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/**
 * For server actions, where redirect() is the wrong shape.
 *
 * Denials are recorded: doc 11 §14 asks for monitoring of repeated
 * authorization failures, which needs them to be visible in the first place.
 */
export async function assertPermission(
  permission: Permission,
): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user || !can(user.roles, permission)) {
    console.warn("[authz] denied", { userId: user?.id ?? null, permission });
    await prisma.activityLog.create({
      data: {
        actorUserId: user?.id ?? null,
        eventType: "authz.denied",
        objectType: "permission",
        objectId: permission,
      },
    });
    throw new ForbiddenError(permission);
  }
  return user;
}
