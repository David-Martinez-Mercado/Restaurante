import type { NextFunction, Request, Response } from "express";
import { AppError, hasPermission, type Permission } from "@resto/core";
import { authGuard } from "./authGuard.js";

/**
 * AUTENTICACIÓN + AUTORIZACIÓN en un solo paso: exige un JWT válido y que
 * el rol del usuario tenga al menos uno de los permisos indicados.
 * Uso: router.post('/', requirePermission('dishes:write'), controller.create)
 */
export function requirePermission(...permissions: Permission[]) {
  const authenticate = authGuard();
  return (req: Request, res: Response, next: NextFunction) => {
    authenticate(req, res, (err?: unknown) => {
      if (err) return next(err);
      const role = req.user?.role;
      if (!role || !permissions.some((p) => hasPermission(role, p))) {
        return next(AppError.forbidden());
      }
      next();
    });
  };
}
