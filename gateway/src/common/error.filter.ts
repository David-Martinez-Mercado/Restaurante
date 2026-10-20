import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import type { GatewayRequest } from "../auth/jwt-auth.guard";

const CODE_BY_STATUS: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  503: "SERVICE_UNAVAILABLE",
};

/**
 * Misma forma de error que los servicios Express:
 * { success: false, error: { code, message }, requestId }
 * Así el front maneja un único formato sin importar quién respondió.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<GatewayRequest>();
    const res = http.getResponse<Response>();

    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Error interno del servidor";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const obj = typeof body === "object" ? (body as Record<string, unknown>) : {};
      code = (obj.code as string) ?? CODE_BY_STATUS[status] ?? "ERROR";
      message = (obj.message as string) ?? exception.message;
    } else {
      this.logger.error(exception);
    }

    res.status(status).json({
      success: false,
      error: { code, message },
      requestId: req.requestId,
    });
  }
}
