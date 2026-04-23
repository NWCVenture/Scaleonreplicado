import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./db/schema";
import { sendEmail, buildVerificationEmailHtml } from "./email";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      try {
        await sendEmail({
          to: user.email,
          subject: "SCALEON ERP — Verifique seu email",
          html: buildVerificationEmailHtml(url, user.name),
        });
      } catch (err) {
        console.warn("[email] Falha ao enviar verificação para", user.email, "—", (err as Error).message);
      }
    },
    expiresIn: 60 * 60, // 1 hour
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "funcionario",
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // update every day
    additionalFields: {
      contaAtivaId: {
        type: "string",
        required: false,
      },
    },
  },
  secret: process.env.BETTER_AUTH_SECRET,
  basePath: "/api/auth",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")
    : [],
});

export type Session = typeof auth.$Infer.Session;
