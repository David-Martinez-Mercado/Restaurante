import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "@resto/auth";
import { AppError, type Role } from "@resto/core";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

/**
 * Exige un JWT de acceso válido en `Authorization: Bearer <token>`.
 * Si se pasan roles, además exige que el usuario tenga uno de ellos.
 * Uso: router.get('/admin', authGuard(['admin']), controller.list)
 */
export function authGuard(allowedRoles?: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      return next(AppError.unauthorized("Falta el token de autenticación"));
    }

    const token = header.slice("Bearer ".length).trim();

    try {
      const payload = verifyAccessToken(token);

      if (allowedRoles && allowedRoles.length > 0) {
        if (!allowedRoles.includes(payload.role)) {
          return next(AppError.forbidden());
        }
      }

      req.user = payload;
      next();
    } catch (err) {
      next(err);
    }
  };
}
