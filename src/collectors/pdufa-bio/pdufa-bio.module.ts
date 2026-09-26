import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PdufaCatalyst, CollectionLog } from '../../entities';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { PdufaBioProcessor } from './pdufa-bio.processor';
import { PdufaBioScheduler } from './pdufa-bio.scheduler';
import { PdufaBioService } from './pdufa-bio.service';

/**
 * Moduł kolektora PDUFA.bio.
 * Scrapuje kalendarz dat decyzji FDA. Darmowe, bez autoryzacji.
 * Eksportuje PdufaBioService — używany przez SentimentModule do context injection.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PdufaCatalyst, CollectionLog]),
    BullModule.registerQueue({ name: QUEUE_NAMES.PDUFA_BIO }),
  ],
  providers: [PdufaBioService, PdufaBioProcessor, PdufaBioScheduler],
  exports: [PdufaBioService],
})
export class PdufaBioModule {}
