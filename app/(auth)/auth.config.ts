import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  basePath: "/api/auth",
  trustHost: true,
  pages: {
    signIn: "/login",
    newUser: "/",
  },
  providers: [],
  callbacks: {},
} satisfies NextAuthConfig;
