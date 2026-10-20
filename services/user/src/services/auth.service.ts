import { randomUUID } from "node:crypto";
import type { Role, User } from "@prisma/client";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from "@resto/auth";
import { AppError, DEFAULT_ROLE } from "@resto/core";
import type {
  CreateUserInput,
  LoginInput,
  RegisterInput,
  AuthResponseDTO,
  UserPublicDTO,
} from "@resto/contracts";
import { userRepository } from "../repositories/user.repository.js";
import { refreshTokenRepository } from "../repositories/refreshToken.repository.js";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function toPublicDTO(user: User): UserPublicDTO {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

async function issueTokenPair(user: User): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const accessToken = signAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role,
  });

  const jti = randomUUID();
  const refreshToken = signRefreshToken({ sub: user.id, jti });

  await refreshTokenRepository.create({
    jti,
    userId: user.id,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  return { accessToken, refreshToken };
}

/**
 * CAPA 3 — SERVICE
 * Reglas de negocio de autenticación. No conoce req/res.
 */
async function createAccount(input: RegisterInput, role: Role): Promise<User> {
  const [existingUsername, existingEmail] = await Promise.all([
    userRepository.findByUsername(input.username),
    userRepository.findByEmail(input.email),
  ]);

  if (existingUsername) {
    throw AppError.conflict("El nombre de usuario ya está en uso");
  }
  if (existingEmail) {
    throw AppError.conflict("El correo electrónico ya está registrado");
  }

  return userRepository.create({
    username: input.username,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role,
  });
}

export const authService = {
  /**
   * POST /api/v1/auth/register — registro PÚBLICO (cliente en línea).
   * El rol nunca viene del cliente: siempre nace como DEFAULT_ROLE (customer).
   */
  async register(input: RegisterInput): Promise<AuthResponseDTO> {
    const user = await createAccount(input, DEFAULT_ROLE);

    const tokens = await issueTokenPair(user);

    return {
      success: true,
      user: toPublicDTO(user),
      ...tokens,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  },

  /** POST /api/v1/auth/login */
  async login(input: LoginInput): Promise<AuthResponseDTO> {
    const user = await userRepository.findByUsername(input.username);
    if (!user) {
      throw AppError.invalidCredentials();
    }

    if (user.status === "inactive") {
      throw AppError.forbidden("La cuenta está desactivada");
    }

    const passwordMatches = await verifyPassword(
      input.password,
      user.passwordHash
    );
    if (!passwordMatches) {
      throw AppError.invalidCredentials();
    }

    const tokens = await issueTokenPair(user);

    return {
      success: true,
      user: toPublicDTO(user),
      ...tokens,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  },

  /** POST /api/v1/auth/refresh-token */
  async refreshToken(refreshToken: string): Promise<AuthResponseDTO> {
    const payload = verifyRefreshToken(refreshToken);

    const stored = await refreshTokenRepository.findByJti(payload.jti);
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw AppError.tokenInvalid();
    }

    const user = await userRepository.findById(payload.sub);
    if (!user || user.status === "inactive") {
      throw AppError.tokenInvalid();
    }

    // Rotación: se revoca el token usado y se emite un par nuevo.
    // Mitiga el riesgo de reutilización de un refresh token robado.
    await refreshTokenRepository.revokeByJti(payload.jti);
    const tokens = await issueTokenPair(user);

    return {
      success: true,
      user: toPublicDTO(user),
      ...tokens,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  },

  /** POST /api/v1/auth/users — alta de personal con rol (permiso users:manage). */
  async createUser(input: CreateUserInput): Promise<UserPublicDTO> {
    const { role, ...credentials } = input;
    return toPublicDTO(await createAccount(credentials, role));
  },

  /**
   * Crea el administrador inicial si todavía no existe ninguno.
   * Devuelve true si lo creó. Sin este paso nadie podría dar de alta al personal.
   */
  async ensureBootstrapAdmin(input: RegisterInput): Promise<boolean> {
    if ((await userRepository.countByRole("admin")) > 0) return false;
    await createAccount(input, "admin");
    return true;
  },

  /** GET /api/v1/auth/me */
  async getProfile(userId: string): Promise<UserPublicDTO> {
    const user = await userRepository.findById(userId);
    if (!user || user.status === "inactive") {
      throw AppError.unauthorized("La cuenta ya no está activa");
    }
    return toPublicDTO(user);
  },

  /** GET /api/v1/auth/users */
  async listUsers(): Promise<UserPublicDTO[]> {
    const users = await userRepository.findAll();
    return users.map(toPublicDTO);
  },

  /** POST /api/v1/auth/logout */
  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = verifyRefreshToken(refreshToken);
      await refreshTokenRepository.revokeByJti(payload.jti);
    } catch {
      // Logout es idempotente: un token ya inválido o expirado
      // no debe impedir que el cliente cierre sesión localmente.
    }
  },
};
