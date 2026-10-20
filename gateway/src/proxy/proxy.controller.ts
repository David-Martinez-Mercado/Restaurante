import {
  All,
  Controller,
  HttpException,
  MethodNotAllowedException,
  NotFoundException,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { GatewayRequest } from "../auth/jwt-auth.guard";
import { loadConfig } from "../config";
import { extraForwardedHeaders, matchRoute, type ServiceName } from "../routing";

// Solo estos encabezados cruzan el gateway. En particular NO se reenvía
// x-internal-key: un cliente no debe poder hacerse pasar por un servicio.
const FORWARDED_HEADERS = ["authorization", "content-type", "accept"];

@Controller()
export class ProxyController {
  private readonly config = loadConfig();

  private upstreamUrl(service: ServiceName): string {
    const urls: Record<ServiceName, string> = {
      user: this.config.USER_SERVICE_URL,
      menu: this.config.MENU_SERVICE_URL,
      order: this.config.ORDER_SERVICE_URL,
      audit: this.config.AUDIT_SERVICE_URL,
      customer: this.config.CUSTOMER_SERVICE_URL,
      reservation: this.config.RESERVATION_SERVICE_URL,
      notification: this.config.NOTIFICATION_SERVICE_URL,
      payment: this.config.PAYMENT_SERVICE_URL,
      attendance: this.config.ATTENDANCE_SERVICE_URL,
      payroll: this.config.PAYROLL_SERVICE_URL,
    };
    return urls[service].replace(/\/$/, "");
  }

  @All("api/v1/*path")
  async forward(
    @Req() req: GatewayRequest & { rawBody?: Buffer },
    @Res() res: Response
  ): Promise<void> {
    const rule = matchRoute(req.path);
    if (!rule) throw new NotFoundException({ code: "NOT_FOUND", message: `Ruta no encontrada: ${req.method} ${req.path}` });
    if (rule.methods && !rule.methods.includes(req.method)) {
      throw new MethodNotAllowedException({
        code: "METHOD_NOT_ALLOWED",
        message: "Método no permitido en el gateway",
      });
    }

    const headers: Record<string, string> = {
      "x-request-id": req.requestId ?? "",
    };
    for (const name of [...FORWARDED_HEADERS, ...extraForwardedHeaders(req.path)]) {
      const value = req.header(name);
      if (value) headers[name] = value;
    }

    const hasBody = !["GET", "HEAD", "DELETE"].includes(req.method);
    const hasPayload =
      hasBody && req.body && Object.keys(req.body as object).length > 0;

    // Se reenvían los bytes originales cuando existen: una firma (webhook de pagos) se calcula
    // sobre el cuerpo exacto, y volver a serializar el JSON podría cambiarlo.
    const body: string | Buffer | undefined = hasPayload
      ? (req.rawBody ?? JSON.stringify(req.body))
      : undefined;

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${this.upstreamUrl(rule.service)}${req.originalUrl}`, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new HttpException(
        {
          code: "SERVICE_UNAVAILABLE",
          message: `El servicio ${rule.service} no está disponible`,
        },
        503
      );
    }

    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);

    if (upstream.status === 204) {
      res.end();
      return;
    }
    res.send(await upstream.text());
  }
}
