import { z } from "zod";
import { ROLES } from "@resto/core";

/**
 * Esquemas Zod de Auth — fuente única de verdad.
 * El backend valida con estos esquemas en la frontera de la ruta;
 * el frontend importa los tipos inferidos (`RegisterInput`, etc.).
 * Referencia: Especificacion_Tecnica_Exhaustiva.docx, sección 3.1.
 */

const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "El usuario debe tener al menos 3 caracteres")
    .max(50, "El usuario no puede exceder 50 caracteres")
    .regex(
      /^[a-zA-Z0-9_.-]+$/,
      "El usuario solo puede contener letras, números, puntos, guiones y guion bajo"
    ),
  email: z.string().trim().toLowerCase().email("Correo electrónico inválido"),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(72, "La contraseña no puede exceder 72 caracteres")
    .regex(/[a-z]/, "La contraseña debe incluir al menos una minúscula")
    .regex(/[A-Z]/, "La contraseña debe incluir al menos una mayúscula")
    .regex(/[0-9]/, "La contraseña debe incluir al menos un número"),
});

/**
 * Registro PÚBLICO (cliente en línea): no acepta `role`. Cualquier rol enviado
 * se descarta y la cuenta nace como `customer`. Evita que alguien se
 * autoasigne privilegios de personal.
 */
export const registerSchema = credentialsSchema;
export type RegisterInput = z.infer<typeof registerSchema>;

/** Alta de personal: solo para quien tenga el permiso `users:manage` (administrador). */
export const createUserSchema = credentialsSchema.extend({
  role: z.enum(ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1, "El usuario es requerido"),
  password: z.string().min(1, "La contraseña es requerida"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "El refresh token es requerido"),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, "El refresh token es requerido"),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

/** DTO de salida — jamás incluye passwordHash. */
export interface UserPublicDTO {
  id: string;
  username: string;
  email: string;
  role: (typeof ROLES)[number];
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponseDTO {
  success: true;
  user: UserPublicDTO;
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // segundos
}
