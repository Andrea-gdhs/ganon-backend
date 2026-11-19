import { Module } from '@nestjs/common';
import { N8nApiKeyGuard } from './n8n-api-key.guard';
import { N8nIntegrationController } from './n8n-integration.controller';
import { N8nIntegrationService } from './n8n-integration.service';

@Module({
  controllers: [N8nIntegrationController],
  providers: [N8nApiKeyGuard, N8nIntegrationService],
})
export class N8nIntegrationModule {}