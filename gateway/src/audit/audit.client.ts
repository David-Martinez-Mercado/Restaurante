import { Injectable, Logger } from "@nestjs/common";
import { loadConfig } from "../config";

export interface GatewayAuditEvent {
  action: string;
  resource: string;
  outcome: "success" | "failure" | "denied";
  statusCode?: number;
  userId?: string;
  username?: string;
  role?: string;
  method?: string;
  path?: string;
  ip?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

/** Envía eventos al Audit Service (accounting). Nunca bloquea ni rompe la petición. */
@Injectable()
export class AuditClient {
  private readonly logger = new Logger(AuditClient.name);
  private readonly config = loadConfig();

  emit(event: GatewayAuditEvent): void {
    fetch(`${this.config.AUDIT_SERVICE_URL}/api/v1/audit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-key": this.config.INTERNAL_API_KEY,
      },
      body: JSON.stringify({ service: "gateway", ...event }),
      signal: AbortSignal.timeout(2000),
    }).catch((err: unknown) => {
      this.logger.warn(`No se pudo enviar evento de auditoría: ${String(err)}`);
    });
  }
}
