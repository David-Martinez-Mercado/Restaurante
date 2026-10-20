/**
 * Catálogo único de códigos de error del sistema.
 * Toda respuesta de error en cualquier servicio usa uno de estos códigos.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_CREDENTIALS"
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export interface ErrorDetail {
  field: string;
  issue: string;
}

/**
 * Error de aplicación con código HTTP y código de negocio asociados.
 * Lanzarlo desde cualquier capa; el errorHandler central lo traduce a JSON.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: ErrorDetail[];

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details?: ErrorDetail[]
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static validation(message: string, details?: ErrorDetail[]): AppError {
    return new AppError("VALIDATION_ERROR", message, 422, details);
  }

  static unauthorized(message = "No autenticado"): AppError {
    return new AppError("UNAUTHORIZED", message, 401);
  }

  static forbidden(message = "No tiene permisos para esta acción"): AppError {
    return new AppError("FORBIDDEN", message, 403);
  }

  static notFound(resource: string): AppError {
    return new AppError("NOT_FOUND", `${resource} no encontrado`, 404);
  }

  static conflict(message: string): AppError {
    return new AppError("CONFLICT", message, 409);
  }

  static invalidCredentials(): AppError {
    return new AppError(
      "INVALID_CREDENTIALS",
      "Usuario o contraseña incorrectos",
      401
    );
  }

  static tokenExpired(): AppError {
    return new AppError("TOKEN_EXPIRED", "El token ha expirado", 401);
  }

  static tokenInvalid(): AppError {
    return new AppError("TOKEN_INVALID", "Token inválido", 401);
  }

  static serviceUnavailable(service: string): AppError {
    return new AppError(
      "SERVICE_UNAVAILABLE",
      `El servicio ${service} no está disponible`,
      503
    );
  }

  static internal(message = "Error interno del servidor"): AppError {
    return new AppError("INTERNAL_ERROR", message, 500);
  }
}
