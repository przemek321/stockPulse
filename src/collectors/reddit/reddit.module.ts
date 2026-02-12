import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { RedditService } from './reddit.service';
import { RedditProcessor } from './reddit.processor';
import { RedditScheduler } from './reddit.scheduler';
import { RawMention, Ticker, CollectionLog } from '../../entities';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Moduł kolektora Reddit.
 * Wymaga REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD.
 * Jeśli nie skonfigurowane — scheduler się nie uruchomi, zbieranie pomijane.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RawMention, Ticker, CollectionLog]),
    BullModule.registerQueue({ name: QUEUE_NAMES.REDDIT }),
  ],
  providers: [RedditService, RedditProcessor, RedditScheduler],
  exports: [RedditService],
})
export class RedditModule {}
