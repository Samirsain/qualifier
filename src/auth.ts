import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clientKey, rateLimit, resetLimit } from "@/lib/rate-limit";
import type { RoleCode } from "@/lib/rbac";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: RoleCode[];
    } & DefaultSession["user"];
  }
}

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        // Doc 11 §2 — slow credential stuffing. Limited per client and per
        // account, so one attacker cannot lock out every user by guessing.
        const key = clientKey(request.headers, "auth");
        const perClient = rateLimit(key, 10, 300);
        const perAccount = rateLimit(
          `auth:acct:${parsed.data.email.toLowerCase()}`,
          5,
          300,
        );
        if (!perClient.allowed || !perAccount.allowed) {
          console.warn("[auth] rate limit hit", {
            key,
            retryAfterSeconds: Math.max(
              perClient.retryAfterSeconds,
              perAccount.retryAfterSeconds,
            ),
          });
          await prisma.activityLog.create({
            data: {
              eventType: "auth.rate_limited",
              objectType: "auth",
              metadata: { key },
            },
          });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          include: { userRoles: { include: { role: true } } },
        });

        // §7: disabled/suspended users must not obtain a session.
        if (!user || user.status !== "ACTIVE" || !user.passwordHash) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        // A genuine sign-in clears the attempt counters.
        resetLimit(clientKey(request.headers, "auth"));
        resetLimit(`auth:acct:${parsed.data.email.toLowerCase()}`);

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        await prisma.activityLog.create({
          data: {
            actorUserId: user.id,
            eventType: "auth.login",
            objectType: "user",
            objectId: user.id,
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          roles: user.userRoles.map((ur) => ur.role.code as RoleCode),
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.roles = (user as { roles?: RoleCode[] }).roles ?? [];
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.roles = (token.roles as RoleCode[]) ?? [];
      return session;
    },
  },
});
