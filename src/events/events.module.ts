import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

/**
 * Moduł Event Bus — komunikacja między modułami przez eventy.
 * Na start używamy EventEmitter2 (in-process).
 * Ścieżka migracji: Redis Streams gdy potrzebna skalowalność.
 */
@Module({
  imports: [
    EventEmitterModule.forRoot({
      // Wildcard pozwala nasłuchiwać np. 'mention.*'
      wildcard: true,
      delimiter: '.',
    }),
  ],
})
export class EventsModule {}
