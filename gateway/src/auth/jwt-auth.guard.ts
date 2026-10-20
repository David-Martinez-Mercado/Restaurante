import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { Request } from "express";
import { AuditClient } from "../audit/audit.client";
import { loadConfig } from "../config";
import { isPublic } from "../routing";

export interface AccessTokenClaims {
  sub: string;
  username: string;
  role: string;
  type: string;
}

export type GatewayRequest = Request & {
  user?: AccessTokenClaims;
  requestId?: string;
};

/**
 * AUTENTICACIÓN en el borde: ninguna petición llega a un servicio interno
 * sin un JWT de acceso válido (salvo login/registro/salud). Los intentos
 * rechazados se registran en auditoría como "denied".
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret = loadConfig().JWT_ACCESS_SECRET;

  constructor(private readonly audit: AuditClient) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<GatewayRequest>();
    const path = req.path;

    if (isPublic(req.method, path)) return true;

    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      this.deny(req, "UNAUTHORIZED", "Falta el token de autenticación");
    }

    try {
      const claims = jwt.verify(
        header!.slice("Bearer ".length).trim(),
        this.secret
      ) as AccessTokenClaims;
      if (claims.type !== "access") throw new Error("tipo de token incorrecto");
      req.user = claims;
      return true;
    } catch (err) {
      const expired = err instanceof jwt.TokenExpiredError;
      this.deny(
        req,
        expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
        expired ? "El token ha expirado" : "Token inválido"
      );
    }
  }

  private deny(req: GatewayRequest, code: string, message: string): never {
    this.audit.emit({
      action: "gateway.auth.denied",
      resource: "session",
      outcome: "denied",
      statusCode: 401,
      method: req.method,
      path: req.path,
      ip: req.ip,
      requestId: req.requestId,
      metadata: { reason: code },
    });
    throw new UnauthorizedException({ code, message });
  }
}
