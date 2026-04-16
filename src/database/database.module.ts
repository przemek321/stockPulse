import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

/**
 * Moduł bazy danych — TypeORM z PostgreSQL + TimescaleDB.
 * Konfiguracja ładowana z .env przez ConfigService.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST'),
        port: config.get<number>('POSTGRES_PORT'),
        database: config.get<string>('POSTGRES_DB'),
        username: config.get<string>('POSTGRES_USER'),
        password: config.get<string>('POSTGRES_PASSWORD'),
        entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
        // Solo dev, 1 maszyna prod — synchronize zawsze aktywne.
        // Docelowo (Sprint 18+): migracje TypeORM.
        synchronize: true,
        logging: config.get<string>('NODE_ENV') === 'development',
      }),
    }),
  ],
})
export class DatabaseModule {}
