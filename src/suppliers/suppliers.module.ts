import { Module } from '@nestjs/common';
import { KeycloakAuthGuard } from '../auth/keycloak-auth.guard';
import { SuppliersController } from './suppliers.controller';
import { KeycloakAdminService } from './keycloak-admin.service';
import { SuppliersService } from './suppliers.service';

@Module({
  controllers: [SuppliersController],
  providers: [KeycloakAuthGuard, KeycloakAdminService, SuppliersService],
})
export class SuppliersModule {}
