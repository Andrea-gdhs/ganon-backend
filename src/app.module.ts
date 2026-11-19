
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { SuppliersModule } from './suppliers/suppliers.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { N8nIntegrationModule } from './integrations/n8n-integration.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE || 'ganon_portal',
      autoLoadEntities: true,
      synchronize: false,
    }),
    SuppliersModule,
    EvaluationsModule,
    N8nIntegrationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}


