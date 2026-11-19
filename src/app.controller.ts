
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
    await this.dataSource.query('SELECT 1');

    return {
      connected: true,
    };
  }
}