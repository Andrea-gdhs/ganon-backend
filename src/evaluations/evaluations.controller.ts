import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
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
  if (user.role !== 'admin' && user.role !== 'buyer') {
    throw new ForbiddenException('Solo Compras puede consultar o crear evaluaciones.');
  }
}

function requireSupplierCatalogAccess(user: PortalAuthUser): void {
  if (user.role !== 'admin' && user.role !== 'buyer' && user.role !== 'cedis') {
    throw new ForbiddenException('Este usuario no puede consultar el catálogo de proveedores.');
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

  @Get('supplier-catalog')
  getSupplierCatalog(@Req() request: Request) {
    requireSupplierCatalogAccess(currentUser(request));
    return this.evaluations.getSupplierCatalog();
  }

    @Get('orders')
  getPortalOrders(@Req() request: Request) {
    const user = currentUser(request);

    if (user.role === 'provider') {
      if (!user.supplierId) {
        throw new ForbiddenException(
          'Tu usuario no tiene un proveedor asignado.',
        );
      }

      return this.evaluations.getPortalOrders(user.supplierId);
    }

    requireBuyerOrAdmin(user);
    return this.evaluations.getPortalOrders();
  }

  @Get('suppliers/:supplierId/orders')
  getSupplierOrderHistory(
    @Req() request: Request,
    @Param('supplierId') supplierId: string,
  ) {
    const user = currentUser(request);
    if (user.role === 'provider') {
      if (String(user.supplierId) !== String(supplierId)) {
        throw new ForbiddenException('Solo puedes consultar las órdenes de tu proveedor.');
      }
    } else {
      requireBuyerOrAdmin(user);
    }
    return this.evaluations.getSupplierOrderHistory(supplierId);
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
    const user = currentUser(request);
    if (user.role !== 'provider') requireBuyerOrAdmin(user);
    return this.evaluations.listEvaluations(user);
  }

  @Post()
  create(@Req() request: Request, @Body() body: unknown) {
    const user = currentUser(request);
    requireBuyerOrAdmin(user);
    return this.evaluations.createEvaluation(user, body);
  }

  @Get(':id')
  getOne(@Req() request: Request, @Param('id') id: string) {
    const user = currentUser(request);
    if (user.role !== 'provider') requireBuyerOrAdmin(user);
    return this.evaluations.getEvaluation(id, user);
  }

  @Post(':id/commitment-response')
  respondToCommitments(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const user = currentUser(request);
    if (user.role !== 'provider') {
      throw new ForbiddenException('Solo el proveedor asignado puede responder los compromisos.');
    }
    return this.evaluations.respondToCommitments(id, user, body);
  }
}
