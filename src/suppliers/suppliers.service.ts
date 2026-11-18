
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findAll() {
    try {
      return await this.dataSource.query(`
        SELECT
          id,
          netsuite_vendor_id,
          supplier_code,
          name,
          email,
          phone,
          active
        FROM suppliers
        ORDER BY name ASC;
      `);
    } catch (error) {
      console.error('Error al consultar proveedores:', error);
      throw new InternalServerErrorException(
        'No fue posible consultar los proveedores',
      );
    }
  }
}
