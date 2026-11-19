import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';

import { N8nApiKeyGuard } from './n8n-api-key.guard';
import { N8nIntegrationService } from './n8n-integration.service';

@Controller('integrations/n8n')
@UseGuards(N8nApiKeyGuard)
export class N8nIntegrationController {
  constructor(
    private readonly n8nIntegrationService: N8nIntegrationService,
  ) {}

  @Get('suppliers')
async getActiveSuppliers() {
  const items =
    await this.n8nIntegrationService.findActiveSuppliersForN8n();

  return { items };
}

  @Post('purchase-orders/sync')
  async syncPurchaseOrder(@Body() body: unknown) {
    return this.n8nIntegrationService.syncPurchaseOrder(body);
  }
}