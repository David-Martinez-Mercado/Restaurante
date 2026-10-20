import { Controller, Get } from "@nestjs/common";
import { loadConfig } from "../config";

type ServiceStatus = "up" | "down";

async function ping(baseUrl: string): Promise<ServiceStatus> {
  try {
    const res = await fetch(`${baseUrl}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok ? "up" : "down";
  } catch {
    return "down";
  }
}

@Controller()
export class HealthController {
  private readonly config = loadConfig();

  @Get("healthz")
  healthz() {
    return { status: "ok" };
  }

  /** Estado agregado de todos los servicios, consultados en paralelo. */
  @Get("api/v1/gateway/health")
  async aggregate() {
    const targets = {
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
    const entries = await Promise.all(
      Object.entries(targets).map(
        async ([name, url]) => [name, await ping(url)] as const
      )
    );
    const services = Object.fromEntries(entries);
    const allUp = entries.every(([, status]) => status === "up");
    return { status: allUp ? "ok" : "degraded", services };
  }
}
