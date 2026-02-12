import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { join } from 'path';
import { envValidationSchema } from './env.validation';

/**
 * Moduł konfiguracji — ładuje .env z walidacją.
 * Importowany globalnie w AppModule.
 * envFilePath wskazuje na .env w katalogu projektu (rozwiązuje problem UNC path na Windows).
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '..', '.env'),
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
  ],
})
export class ConfigModule {}
