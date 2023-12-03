import { InjectorService, LoggerService } from '@cheetah.js/core';
import {
  ColDiff,
  ConnectionSettings,
  Orm,
  OrmService,
  PgDriver,
  TableDiff,
} from '@cheetah.js/orm';
import { EntityStorage } from '@cheetah.js/orm';
import globby from 'globby';
import * as knex from 'knex';
import {
  SnapshotTable,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
} from '@cheetah.js/orm/driver/driver.interface';
import { DiffCalculator } from './diff-calculator';
import * as tsNode from 'ts-node';
import * as path from 'path';
import * as fs from 'fs';

tsNode.register({
  compilerOptions: {
    module: 'CommonJS',
  },
});

export class Migrator {
  config: ConnectionSettings<any>;
  orm: Orm<any>;
  entities: EntityStorage = new EntityStorage();
  knex: knex.Knex;

  constructor() {
    this.orm = Orm.getInstance();
    if (this.orm === undefined)
      this.orm = new Orm(new LoggerService(new InjectorService()));

    this.entities = EntityStorage.getInstance();
    if (this.entities === undefined) this.entities = new EntityStorage();
  }

  async startConnection(basePath: string = process.cwd()) {
    await this.initConfigFile(basePath);
    await this.initKnex();
  }

  private async initConfigFile(basePath: string) {
    const paths = await globby(['cheetah.config.ts'], {
      absolute: true,
      cwd: basePath,
    });

    if (paths.length === 0) {
      throw new Error('Config file not found');
    }

    const config = await import(paths[0]);
    this.config = config.default;

    if (typeof this.config.entities === 'string') {
      const paths = await globby(this.config.entities, {
        absolute: true,
        cwd: basePath,
      });
      for (const path of paths) {
        console.log(`Importing entity from: ${path}`);
        await import(path);
      }
    }

    await this.initOrm();
  }

  private async initOrm() {
    const serv = new OrmService(this.orm, this.entities);
    await serv.onInit(this.config);
  }

  private initKnex() {
    this.knex = knex.default({
      client: this.config.driver === PgDriver ? 'pg' : 'mysql',
      connection: {
        host: this.config.host,
        user: this.config.username,
        password: this.config.password,
        database: this.config.database,
        uri: this.config.connectionString as any,
      },
      debug: true,
    });
  }

  private async run(diff: TableDiff[]) {
    const sql = [];

    for (const tableDiff of diff) {
      let query;

      if (tableDiff.newTable) {
        query = await this.createTable(tableDiff);
      } else {
        query = this.knex.schema
          .withSchema(tableDiff.schema)
          .table(tableDiff.tableName, (builder) => {
            for (const colDiff of tableDiff.colDiffs) {
              if (colDiff.actionType === 'INDEX') {
                colDiff.indexTables.forEach((indexTable) => {
                  if (typeof indexTable.properties === 'undefined') {
                    builder.dropIndex([], indexTable.name);
                  } else {
                    builder.index(indexTable.properties, indexTable.name);
                  }
                });
              }

              if (colDiff.actionType === 'DELETE') {
                builder.dropColumn(colDiff.colName);
                continue;
              }

              if (
                colDiff.actionType === 'ALTER' &&
                !colDiff.colType &&
                typeof colDiff.colChanges === 'undefined'
              )
                continue;

              /**
               * Change unique
               *
               */
              if (typeof colDiff.colChanges?.unique !== 'undefined') {
                if (colDiff.colChanges?.unique) {
                  builder.unique(
                    [colDiff.colName],
                    `${tableDiff.tableName}_${colDiff.colName}_key`,
                  );
                } else {
                  builder.dropUnique(
                    [colDiff.colName],
                    `${tableDiff.tableName}_${colDiff.colName}_key`,
                  );
                }
              }

              /**
               * Change Fks
               *
               */
              if (typeof colDiff.colChanges?.foreignKeys !== 'undefined') {
                if (colDiff.colChanges.foreignKeys.length !== 0) {
                  colDiff.colChanges.foreignKeys.forEach((fk) => {
                    builder
                      .foreign(
                        colDiff.colName,
                        `${tableDiff.tableName}_${colDiff.colName}_fk`,
                      )
                      .references(
                        `${fk.referencedTableName}.${fk.referencedColumnName}`,
                      );
                  });
                } else {
                  builder.dropForeign(
                    colDiff.colName,
                    `${tableDiff.tableName}_${colDiff.colName}_fk`,
                  );
                }
              }

              const columnBuilder = this.assignType(builder, colDiff, tableDiff);

              if (!columnBuilder) continue;

              if (colDiff.actionType === 'ALTER') {
                columnBuilder.alter({ alterNullable: false });
                continue;
              }
            }
          })
          .toSQL();
      }
      sql.push(...query.flatMap((q) => q.sql.concat(';')));
    }

    return sql;
  }

  private async createTable(tableDiff: TableDiff) {
    return await this.knex.schema
      .withSchema(tableDiff.schema)
      .createTable(tableDiff.tableName, (builder) => {
        for (const diff of tableDiff.colDiffs) {
          if (diff.actionType === 'INDEX') {
            diff.indexTables.forEach((indexTable) => {
              if (typeof indexTable.properties === 'undefined') {
                builder.dropIndex([], indexTable.name);
              } else {
                if (indexTable.name.includes('pkey')) {
                  return;
                }
                builder.index(indexTable.properties, indexTable.name);
              }
            });
          }

          /**
           * Change Fks
           *
           */
          if (typeof diff.colChanges?.foreignKeys !== 'undefined') {
            if (diff.colChanges.foreignKeys.length !== 0) {
              diff.colChanges.foreignKeys.forEach((fk) => {
                builder
                  .foreign(diff.colName, `${tableDiff.tableName}_${diff.colName}_fk`)
                  .references(
                    `${fk.referencedTableName}.${fk.referencedColumnName}`,
                  );
              });
            } else {
              builder.dropForeign(
                diff.colName,
                `${tableDiff.tableName}_${diff.colName}_fk`,
              );
            }
          }

          this.assignType(builder, diff, tableDiff);

          if (typeof diff.colChanges?.unique !== 'undefined') {
            if (diff.colChanges?.unique) {
              builder.unique(
                [diff.colName],
                `${tableDiff.tableName}_${diff.colName}_key`,
              );
            } else {
              builder.dropUnique(
                [diff.colName],
                `${tableDiff.tableName}_${diff.colName}_key`,
              );
            }
          }
        }
      })
      .toSQL();
  }

  assignType(
    builder: knex.Knex.AlterTableBuilder,
    diff: ColDiff,
    tableDiff: TableDiff,
  ): knex.Knex.ColumnBuilder {
    if (diff.actionType === 'ALTER') {
      if (diff.colChanges?.nullable !== undefined) {
        if (diff.colChanges?.nullable) {
          builder.setNullable(diff.colName);
        }
      }
    }

    if (!diff.colType) return;
    const columnName = diff.colName;
    const columnType = diff.colType;
    let columnBuilder: knex.Knex.ColumnBuilder;

    if (diff.colChanges?.autoIncrement !== undefined) {
      if (diff.colChanges?.autoIncrement) {
        columnBuilder = builder.increments(diff.colName, {
          primaryKey: diff.colChanges?.primary,
        });
      }
    } else {
      switch (columnType) {
        case 'varchar':
          columnBuilder = builder.string(columnName, diff.colLength);
          break;
        case 'text':
          columnBuilder = builder.text(columnName);
          break;
        case 'int':
        case 'numeric':
          columnBuilder = builder.integer(columnName, diff.colLength);
          break;
        case 'bigint':
          columnBuilder = builder.bigInteger(columnName);
          break;
        case 'float':
          columnBuilder = builder.float(columnName);
          break;
        case 'double':
          columnBuilder = builder.double(columnName);
          break;
        case 'decimal':
          columnBuilder = builder.decimal(columnName);
          break;
        case 'date':
          columnBuilder = builder.date(columnName);
          break;
        case 'datetime':
          columnBuilder = builder.datetime(columnName);
          break;
        case 'time':
          columnBuilder = builder.time(columnName);
          break;
        case 'timestamp':
          columnBuilder = builder.timestamp(columnName, {
            precision: diff.colLength,
          });
          break;
        case 'boolean':
          columnBuilder = builder.boolean(columnName);
          break;
        case 'json':
          columnBuilder = builder.json(columnName);
          break;
        case 'jsonb':
          columnBuilder = builder.jsonb(columnName);
          break;
        case 'enum':
          if (diff.actionType === 'ALTER' && diff.colChanges?.enumItems) {
            columnBuilder = builder
              .text(columnName)
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              //@ts-ignore
              .checkIn(diff.colChanges.enumItems ?? [], `${columnName}_check`);
          } else {
            columnBuilder = builder.enum(
              columnName,
              diff.colChanges.enumItems ?? [],
            );
          }
          break;
        case 'array':
          columnBuilder = builder.specificType(columnName, 'text[]');
          break;
        case 'uuid':
          columnBuilder = builder.uuid(columnName);
          break;
        default:
          columnBuilder = builder.string(columnName, diff.colLength);
          break;
      }
    }
    /** DEFAULTS */
    columnBuilder.notNullable();

    if (diff.colChanges?.nullable !== undefined) {
      if (diff.colChanges?.nullable) {
        columnBuilder.nullable();
      }
    }

    if (diff.colChanges?.default) {
      columnBuilder.defaultTo(diff.colChanges?.default);
    }

    if (typeof diff.colChanges?.primary !== 'undefined') {
      if (diff.colChanges?.primary) {
        columnBuilder.primary();
      } else {
        builder.dropPrimary();
      }
    }

    return columnBuilder;
  }

  async migrate() {
    await this.startConnection();
    const migrationTable = 'cheetah_migrations';
    const migrationDirectory = path.join(
      process.cwd(),
      this.config.migrationPath ?? 'database/migrations',
    );
    const migrationFiles = fs
      .readdirSync(migrationDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      this.orm.logger.info('No migration files found');
      return;
    }

    this.orm.driverInstance.executeSql(
      `CREATE TABLE IF NOT EXISTS "${migrationTable}" ("migration_file" character varying(255) NOT NULL PRIMARY KEY UNIQUE);`,
    );

    const migrated = await this.orm.driverInstance.executeSql(
      `SELECT * FROM "${migrationTable}" ORDER BY "migration_file" ASC;`,
    );
    const lastMigration = migrated.rows[migrated.rows.length - 1];
    const lastMigrationIndex = migrationFiles.indexOf(
      lastMigration?.migration_file ?? '',
    );
    const migrationsToExecute = migrationFiles.slice(lastMigrationIndex + 1);

    if (migrationsToExecute.length === 0) {
      this.orm.logger.info('Database is up to date');
      return;
    }

    for (const migrationFile of migrationsToExecute) {
      const migrationFilePath = path.join(migrationDirectory, migrationFile);
      const migrationContent = fs.readFileSync(migrationFilePath, {
        encoding: 'utf-8',
      });
      const sqlInstructions = migrationContent
        .split(';')
        .filter((sql) => sql.trim().length > 0);

      for (const sqlInstruction of sqlInstructions) {
        await this.orm.driverInstance.executeSql(sqlInstruction);
      }

      await this.orm.driverInstance.executeSql(
        `INSERT INTO "${migrationTable}" ("migration_file") VALUES ('${migrationFile}');`,
      );

      this.orm.logger.info(`Migration executed: ${migrationFile}`);
    }
  }

  async generateMigration(
    configFile: string = process.cwd(),
    onlySql: boolean = false,
  ) {
    await this.startConnection(configFile);
    const snapshotBd = await this.snapshotBd();
    const snapshotEntities = await this.snapshotEntities();
    const calculator = new DiffCalculator(this.entities);
    const diff = calculator.diff(snapshotBd, snapshotEntities);

    const sql = this.lastTreatment(await this.run(diff));

    if (onlySql) {
      return sql;
    }

    // save sql in file
    const fs = await import('fs');
    const path = await import('path');
    const directory = path.join(
      process.cwd(),
      this.config.migrationPath ?? 'database/migrations',
    );
    const fileName =
      `migration_${new Date().toISOString().replace(/[^\d]/g, '')}` + `.sql`;
    const migrationFilePath = path.join(directory, fileName);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const migrationContent = sql.join('\n');

    if (migrationContent.length === 0) {
      this.orm.logger.info('No changes detected');
      return;
    } else {
      fs.writeFileSync(migrationFilePath, migrationContent);
      this.orm.logger.info(`Migration file created: ${migrationFilePath}`);
    }
  }

  private lastTreatment(sql: any[]) {
    const getDropIndexes = sql.filter((s) => s.startsWith('drop index'));

    // Drop indexes not execute if the column is deleted
    const getDropColumns = sql.filter((s) => s.includes('drop column'));
    const dropIndexes = [];
    for (const dropIndex of getDropIndexes) {
      const indexName = dropIndex.split(' ')[2].split('_');
      let colName;

      if (indexName.length === 3) {
        colName = indexName[1];
      } else {
        colName = indexName[0];
      }
      colName = colName.split('.')[1].replace(/"/g, '');

      const dropColumn = getDropColumns.find((s) => s.includes(colName));

      if (dropColumn) {
        dropIndexes.push(dropIndex);
      }
    }

    const sqlFiltered = sql.filter((s) => !dropIndexes.includes(s));

    return sqlFiltered;
  }

  private async snapshotBd(): Promise<SnapshotTable[]> {
    const snapshot = [];
    for (const [_, values] of this.entities.entries()) {
      const bd = await this.orm.driverInstance.snapshot(values.tableName);
      if (!bd) {
        continue;
      }
      snapshot.push(bd);
    }
    return snapshot;
  }

  private async snapshotEntities() {
    const snapshot = [];
    for (const [_, values] of this.entities.entries()) {
      snapshot.push(await this.entities.snapshot(values));
    }
    return snapshot;
  }
}
