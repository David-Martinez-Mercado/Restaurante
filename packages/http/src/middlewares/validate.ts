import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";
import { AppError, type ErrorDetail } from "@resto/core";

type Source = "body" | "query" | "params";

function zodErrorToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    issue: issue.message,
  }));
}

/**
 * Valida `req[source]` contra un esquema Zod y sustituye el valor original
 * por el ya parseado (con defaults, coerciones y trims aplicados).
 * Lanza AppError.validation en caso de fallo — lo captura el errorHandler.
 *
 * Los servicios NUNCA validan de nuevo: reciben datos ya limpios.
 */
export function validate(schema: ZodSchema, source: Source = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        AppError.validation(
          "Datos de entrada inválidos",
          zodErrorToDetails(result.error)
        )
      );
    }
    req[source] = result.data;
    next();
  };
}
