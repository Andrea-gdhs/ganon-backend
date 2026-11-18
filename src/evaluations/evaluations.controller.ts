import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { KeycloakAuthGuard } from '../auth/keycloak-auth.guard';
import { PortalAuthUser } from '../auth/auth.types';
import { EvaluationsService } from './evaluations.service';

function currentUser(request: Request): PortalAuthUser {
  if (!request.user) throw new ForbiddenException('No se pudo identificar al usuario.');
  return request.user;
}

function requireBuyerOrAdmin(user: PortalAuthUser): void {
  if (user.role === 'provider') {
    throw new ForbiddenException('Solo Compras puede consultar o crear evaluaciones.');
  }
}

@Controller('evaluations')
@UseGuards(KeycloakAuthGuard)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get('catalog')
  getCommitmentCatalog() {
    return this.evaluations.getCommitmentCatalog();
  }

  @Get('suppliers')
  getSuppliers(@Req() request: Request) {
    requireBuyerOrAdmin(currentUser(request));
    return this.evaluations.getActiveSuppliers();
  }

  @Get('metrics')
  previewMetrics(
    @Req() request: Request,
    @Query('supplierId') supplierId: string,
    @Query('periodType') periodType: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    requireBuyerOrAdmin(currentUser(request));
    return this.evaluations.previewMetrics(supplierId, periodType, periodStart, periodEnd);
  }

  @Get()
  list(@Req() request: Request) {
    return this.evaluations.listEvaluations(currentUser(request));
  }

  @Post()
  create(@Req() request: Request, @Body() body: unknown) {
    const user = currentUser(request);
    requireBuyerOrAdmin(user);
    return this.evaluations.createEvaluation(user, body);
  }

  @Get(':id')
  getOne(@Req() request: Request, @Param('id') id: string) {
    return this.evaluations.getEvaluation(id, currentUser(request));
  }
}
