import { Module } from '@nestjs/common';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';
import { KeycloakAuthGuard } from '../auth/keycloak-auth.guard';

@Module({
  controllers: [EvaluationsController],
  providers: [EvaluationsService, KeycloakAuthGuard],
})
export class EvaluationsModule {}
