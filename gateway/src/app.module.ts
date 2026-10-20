import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuditClient } from "./audit/audit.client";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { ErrorFilter } from "./common/error.filter";
import { HealthController } from "./health/health.controller";
import { ProxyController } from "./proxy/proxy.controller";

@Module({
  // HealthController va primero: sus rutas exactas deben ganar al comodín del proxy.
  controllers: [HealthController, ProxyController],
  providers: [
    AuditClient,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
