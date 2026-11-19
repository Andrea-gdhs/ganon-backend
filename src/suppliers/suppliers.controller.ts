
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { KeycloakAuthGuard } from '../auth/keycloak-auth.guard';
import { PortalAuthUser } from '../auth/auth.types';
import { SuppliersService } from './suppliers.service';

function currentUser(request: Request): PortalAuthUser {
  if (!request.user) throw new ForbiddenException('No se pudo identificar al usuario.');
  return request.user;
}

function requireAdmin(user: PortalAuthUser): void {
  if (user.role !== 'admin') {
    throw new ForbiddenException('Solo el administrador puede gestionar proveedores.');
  }
}

@Controller('suppliers')
@UseGuards(KeycloakAuthGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  findAll(@Req() request: Request) {
    requireAdmin(currentUser(request));
    return this.suppliersService.findAll();
  }

  @Post()
  create(@Req() request: Request, @Body() body: unknown) {
    requireAdmin(currentUser(request));
    return this.suppliersService.create(body);
  }

  @Patch(':id')
  update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    requireAdmin(currentUser(request));
    return this.suppliersService.update(id, body);
  }

  @Patch(':id/active')
  setActive(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    requireAdmin(currentUser(request));
    if (
      typeof body !== 'object' ||
      body === null ||
      !('active' in body) ||
      typeof body.active !== 'boolean'
    ) {
      throw new BadRequestException('Indica si el proveedor debe quedar activo o inactivo.');
    }
    return this.suppliersService.setActive(id, body.active);
  }

  @Patch(':id/netsuite-vendor-id')
  updateNetSuiteVendorId(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    requireAdmin(currentUser(request));
    return this.suppliersService.updateNetSuiteVendorId(id, body);
  }
}
