import type { RefreshToken } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * CAPA 4 — REPOSITORY
 * Persistencia de refresh tokens: permite revocar (logout) y detectar
 * reutilización de tokens robados.
 */
export const refreshTokenRepository = {
  async create(data: {
    jti: string;
    userId: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return prisma.refreshToken.create({ data });
  },

  async findByJti(jti: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({ where: { jti } });
  },

  async revokeByJti(jti: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async revokeAllForUser(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};
