import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard dla wrażliwych endpointów (/system-logs/trace, /system-logs/ticker, /system-logs/decisions).
 * Wymaga nagłówka X-Api-Token równego ADMIN_API_TOKEN z .env.
 *
 * Użycie:
 *   @UseGuards(ApiTokenGuard)
 *   @Get('protected')
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-api-token'];
    const expected = this.config.get<string>('ADMIN_API_TOKEN');

    if (!expected) {
      throw new UnauthorizedException(
        'ADMIN_API_TOKEN nie skonfigurowany — dostęp zablokowany',
      );
    }

    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid or missing X-Api-Token');
    }

    return true;
  }
}
