import { Controller, Get } from '@nestjs/common';
import { StocktwitsService } from '../../collectors/stocktwits/stocktwits.service';
import { FinnhubService } from '../../collectors/finnhub/finnhub.service';
import { SecEdgarService } from '../../collectors/sec-edgar/sec-edgar.service';
import { RedditService } from '../../collectors/reddit/reddit.service';
import { TelegramService } from '../../alerts/telegram/telegram.service';

/**
 * GET /api/health — status zdrowia systemu i kolektorów.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly stocktwits: StocktwitsService,
    private readonly finnhub: FinnhubService,
    private readonly secEdgar: SecEdgarService,
    private readonly reddit: RedditService,
    private readonly telegram: TelegramService,
  ) {}

  @Get()
  async getHealth() {
    const [stHealth, fhHealth, secHealth, rdHealth] = await Promise.all([
      this.stocktwits.getHealthStatus(),
      this.finnhub.getHealthStatus(),
      this.secEdgar.getHealthStatus(),
      this.reddit.getHealthStatus(),
    ]);

    const collectors = [stHealth, fhHealth, secHealth, rdHealth];
    const allHealthy = collectors.every((c) => c.isHealthy);

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      telegram: {
        configured: this.telegram.isConfigured(),
      },
      collectors,
    };
  }
}
