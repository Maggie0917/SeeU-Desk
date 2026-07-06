import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "pkad_session";

function getSecret() {
  return process.env.AUTH_SECRET || "dev-secret-change-me";
}

function sign(value: string) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = await new Promise<string>((resolve, reject) => {
    crypto.pbkdf2(password, salt, 120000, 64, "sha512", (error, derivedKey) => {
      if (error) reject(error);
      resolve(derivedKey.toString("base64url"));
    });
  });
  return `${salt}.${hash}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(".");
  if (!salt || !hash) return false;

  const candidate = await new Promise<string>((resolve, reject) => {
    crypto.pbkdf2(password, salt, 120000, 64, "sha512", (error, derivedKey) => {
      if (error) reject(error);
      resolve(derivedKey.toString("base64url"));
    });
  });

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

export async function setSession(userId: string) {
  const payload = Buffer.from(
    JSON.stringify({ userId, issuedAt: Date.now() }),
    "utf8"
  ).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId?: string;
    };
    if (!parsed.userId) return null;

    return prisma.user.findUnique({
      where: { id: parsed.userId },
      select: { id: true, email: true, name: true, createdAt: true }
    });
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
