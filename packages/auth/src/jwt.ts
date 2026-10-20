import jwt from "jsonwebtoken";
import { AppError, type Role } from "@resto/core";

export interface AccessTokenPayload {
  sub: string; // userId
  username: string;
  role: Role;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string; // userId
  jti: string; // id único del token, para poder revocarlo en BD
  type: "refresh";
}

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";

function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET no está configurado");
  }
  return secret;
}

function getRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error("JWT_REFRESH_SECRET no está configurado");
  }
  return secret;
}

export function signAccessToken(
  payload: Omit<AccessTokenPayload, "type">
): string {
  return jwt.sign({ ...payload, type: "access" }, getAccessSecret(), {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function signRefreshToken(
  payload: Omit<RefreshTokenPayload, "type">
): string {
  return jwt.sign({ ...payload, type: "refresh" }, getRefreshSecret(), {
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, getAccessSecret()) as AccessTokenPayload;
    if (decoded.type !== "access") {
      throw AppError.tokenInvalid();
    }
    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) throw AppError.tokenExpired();
    throw AppError.tokenInvalid();
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(
      token,
      getRefreshSecret()
    ) as RefreshTokenPayload;
    if (decoded.type !== "refresh") {
      throw AppError.tokenInvalid();
    }
    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) throw AppError.tokenExpired();
    throw AppError.tokenInvalid();
  }
}

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
