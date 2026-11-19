
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class N8nApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const expectedKey = this.config.get<string>(
      'N8N_INTEGRATION_API_KEY',
    );

    const receivedKey = request.header('x-n8n-api-key') ?? '';

    if (!expectedKey) {
      throw new ServiceUnavailableException(
        'La integración con n8n no está configurada.',
      );
    }

    const expectedBuffer = Buffer.from(expectedKey, 'utf8');
    const receivedBuffer = Buffer.from(receivedKey, 'utf8');

    if (
      !receivedKey ||
      expectedBuffer.length !== receivedBuffer.length ||
      !timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      throw new UnauthorizedException(
        'Credencial de integración inválida.',
      );
    }

    return true;
  }
}
