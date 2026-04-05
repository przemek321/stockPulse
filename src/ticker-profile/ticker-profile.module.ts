import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from '../entities';
import { TickerProfileService } from './ticker-profile.service';

/**
 * Profil historyczny per ticker — kontekst kalibrujący conviction w promptach Claude.
 * Eksportuje TickerProfileService do użytku w SecFilingsModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Alert])],
  providers: [TickerProfileService],
  exports: [TickerProfileService],
})
export class TickerProfileModule {}
