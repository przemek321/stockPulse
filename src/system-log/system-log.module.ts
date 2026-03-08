import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { SystemLog } from '../entities/system-log.entity';
import { SystemLogService } from './system-log.service';

/**
 * Moduł logowania systemowego.
 * Global: true — singleton dostępny z decoratora @Logged() bez importu.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SystemLog]),
    ScheduleModule.forRoot(),
  ],
  providers: [SystemLogService],
  exports: [SystemLogService],
})
export class SystemLogModule {}
