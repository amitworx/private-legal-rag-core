import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { pool } from "./db";
import type { AuthRole, AuthUser } from "./types";

dotenv.config();

const authEnabled = process.env.AUTH_ENABLED === "true";
const jwtSecret = (process.env.JWT_SECRET ?? "") as Secret;
const jwtExpiresIn = (process.env.JWT_EXPIRES_IN ?? "12h") as SignOptions["expiresIn"];
const defaultUsername = process.env.AUTH_USERNAME ?? "admin";
const defaultPassword = process.env.AUTH_PASSWORD ?? "change-this-password";
const defaultRole = (process.env.AUTH_ROLE === "user" ? "user" : "admin") as AuthRole;

export function isAuthEnabled(): boolean {
  return authEnabled;
}

export function getJwtSecret(): Secret {
  return jwtSecret;
}

export async function seedDefaultUser(): Promise<void> {
  if (!authEnabled) {
    return;
  }

  if (!jwtSecret) {
    throw new Error("JWT_SECRET must be configured when AUTH_ENABLED=true.");
  }

  const hash = await bcrypt.hash(defaultPassword, 10);

  await pool.query(
    `INSERT INTO app_users (id, username, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [uuidv4(), defaultUsername, hash, defaultRole]
  );
}

export async function validateCredentials(
  username: string,
  password: string
): Promise<AuthUser | null> {
  const result = await pool.query(
    `SELECT id, username, password_hash as "passwordHash", role
     FROM app_users
     WHERE username = $1`,
    [username]
  );

  const user = result.rows[0] as {
    id: string;
    username: string;
    passwordHash: string;
    role: AuthRole;
  } | undefined;

  if (!user) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role
  };
}

export function createAuthToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role
    },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

export function verifyAuthToken(token: string): AuthUser {
  const decoded = jwt.verify(token, jwtSecret) as {
    sub: string;
    username: string;
    role: AuthRole;
  };

  return {
    id: decoded.sub,
    username: decoded.username,
    role: decoded.role
  };
}
