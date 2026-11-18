
import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Get('database/status')
  async getDatabaseStatus() {
    const result = await this.dataSource.query(`
      SELECT COUNT(*) AS total_tablas
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE';
    `);

    return {
      connected: true,
      database: 'ganon_portal',
      totalTables: Number(result[0].total_tablas),
    };
  }
}
