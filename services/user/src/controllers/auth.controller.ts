import type { Request, Response } from "express";
import { permissionsFor } from "@resto/core";
import type {
  CreateUserInput,
  LoginInput,
  LogoutInput,
  RefreshTokenInput,
  RegisterInput,
} from "@resto/contracts";
import { authService } from "../services/auth.service.js";

/**
 * CAPA 2 — CONTROLLER
 * Traduce HTTP <-> dominio. No conoce Prisma ni SQL.
 * req.body ya llega validado por el middleware `validate()`.
 */
export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const input = req.body as RegisterInput;
    const result = await authService.register(input);
    res.locals.auditActor = {
      userId: result.user.id,
      username: result.user.username,
      role: result.user.role,
    };
    res.status(201).json(result);
  },

  async login(req: Request, res: Response): Promise<void> {
    const input = req.body as LoginInput;
    // Se fija antes de autenticar para que un intento fallido quede
    // registrado con el usuario que se intentó usar.
    res.locals.auditActor = { username: input.username };
    const result = await authService.login(input);
    res.locals.auditActor = {
      userId: result.user.id,
      username: result.user.username,
      role: result.user.role,
    };
    res.status(200).json(result);
  },

  async refreshToken(req: Request, res: Response): Promise<void> {
    const input = req.body as RefreshTokenInput;
    const result = await authService.refreshToken(input.refreshToken);
    res.locals.auditActor = {
      userId: result.user.id,
      username: result.user.username,
      role: result.user.role,
    };
    res.status(200).json(result);
  },

  async logout(req: Request, res: Response): Promise<void> {
    const input = req.body as LogoutInput;
    await authService.logout(input.refreshToken);
    res.status(204).send();
  },

  /** GET /api/v1/auth/me — identidad y permisos efectivos del token. */
  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.getProfile(req.user!.sub);
    res.status(200).json({
      success: true,
      user,
      permissions: permissionsFor(user.role),
    });
  },

  /** GET /api/v1/auth/users — listado de usuarios (permiso users:read). */
  /** POST /api/v1/auth/users — alta de personal con rol (permiso users:manage). */
  async createUser(req: Request, res: Response): Promise<void> {
    const data = await authService.createUser(req.body as CreateUserInput);
    res.status(201).json({ success: true, data });
  },

  async listUsers(_req: Request, res: Response): Promise<void> {
    const users = await authService.listUsers();
    res.status(200).json({ success: true, data: users });
  },
};
