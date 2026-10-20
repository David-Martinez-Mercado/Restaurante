import { Router } from "express";
import {
  asyncHandler,
  auditAction,
  authGuard,
  requirePermission,
  validate,
} from "@resto/http";
import {
  createUserSchema,
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  logoutSchema,
} from "@resto/contracts";
import { authController } from "../controllers/auth.controller.js";

/**
 * CAPA 1 — ROUTES
 * Define los endpoints de autenticación. Sin lógica de negocio:
 * sólo aplica validación y delega al controller.
 * Referencia: Especificacion_Tecnica_Exhaustiva.docx, sección 3.1.
 */
export const authRouter = Router();

authRouter.post(
  "/register",
  auditAction("user-service", "auth.register", "user"),
  validate(registerSchema),
  asyncHandler(authController.register)
);

authRouter.post(
  "/login",
  auditAction("user-service", "auth.login", "session"),
  validate(loginSchema),
  asyncHandler(authController.login)
);

authRouter.post(
  "/refresh-token",
  auditAction("user-service", "auth.refresh", "session"),
  validate(refreshTokenSchema),
  asyncHandler(authController.refreshToken)
);

authRouter.post(
  "/logout",
  auditAction("user-service", "auth.logout", "session"),
  validate(logoutSchema),
  asyncHandler(authController.logout)
);

authRouter.get("/me", authGuard(), asyncHandler(authController.me));

authRouter.post(
  "/users",
  auditAction("user-service", "users.create", "user"),
  requirePermission("users:manage"),
  validate(createUserSchema),
  asyncHandler(authController.createUser)
);

authRouter.get(
  "/users",
  auditAction("user-service", "users.list", "user"),
  requirePermission("users:read"),
  asyncHandler(authController.listUsers)
);
