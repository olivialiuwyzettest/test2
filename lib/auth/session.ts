import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = {
  email: string;
  iat: number;
  exp: number;
};

type MutableCookieStore = {
  set: (options: {
    name: string;
    value: string;
    httpOnly: boolean;
    sameSite: "lax";
    secure: boolean;
    maxAge: number;
    path: string;
  }) => void;
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(value: string): string {
  return createHmac("sha256", env.sessionSecret).update(value).digest("base64url");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  const normalized = normalizeEmail(email);
  const [, domain = ""] = normalized.split("@");
  return domain;
}

export function isAllowedEmailDomain(email: string): boolean {
  return env.allowedEmailDomains.includes(emailDomain(email));
}

export function issueSessionToken(email: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    email: normalizeEmail(email),
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
    if (!payload.email || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      ...payload,
      email: normalizeEmail(payload.email),
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(cookieStore: MutableCookieStore, email: string): void {
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: issueSessionToken(email),
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

export function clearSessionCookie(cookieStore: MutableCookieStore): void {
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    maxAge: 0,
    path: "/",
  });
}
