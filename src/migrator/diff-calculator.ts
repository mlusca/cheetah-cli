import { DriverInterface, EntityStorage, PgDriver } from '@cheetah.js/orm';
import { ColDiff, ColumnsInfo, SnapshotTable, TableDiff } from './migrator';

export class DiffCalculator {
  private entities: EntityStorage;

  constructor(
    entities: EntityStorage,
    private driver: DriverInterface,
  ) {
    this.entities = entities;
  }

  diff(snapshotBd: SnapshotTable[], snapshotEntities: SnapshotTable[]): TableDiff[] {
    const diffs: TableDiff[] = [];
    // Cria um mapa (dicionário) para facilitar o acesso por nome da tabela
    const bdTablesMap = new Map(snapshotBd.map((table) => [table.tableName, table]));
    const entityTablesMap = new Map(
      snapshotEntities.map((table) => [table.tableName, table]),
    );

    // Junta todos os nomes de tabelas
    const allTableNames = new Set([
      ...bdTablesMap.keys(),
      ...entityTablesMap.keys(),
    ]);

    allTableNames.forEach((tableName) => {
      const bdTable = bdTablesMap.get(tableName);
      const entityTable = entityTablesMap.get(tableName);

      if (!entityTable) {
        // Se a tabela só está no banco de dados, precisamos deletá-la
        diffs.push({
          tableName,
          colDiffs: [{ actionType: 'DELETE', colName: '*' }], // Indica que todas as colunas devem ser deletadas (ou seja, a tabela inteira)
        });
      } else if (!bdTable) {
        const colDiffs: ColDiff[] = entityTable.columns.flatMap((c) => {
          return this.createNewColumn(c, []);
        });
        // Se a tabela só está nas entidades, precisamos criá-la
        diffs.push({
          tableName,
          newTable: true,
          schema: entityTable.schema ?? 'public',
          colDiffs, // Indica que todas as colunas devem ser criadas
        });
        this.checkIndexes(bdTable, entityTable, colDiffs);
      } else {
        const colDiffs: ColDiff[] = [];
        // Se a tabela está em ambos, precisamos comparar as colunas
        const bdColumnsMap = new Map(bdTable.columns.map((col) => [col.name, col]));
        const entityColumnsMap = new Map(
          entityTable.columns.map((col) => [col.name, col]),
        );
        const allColumnNames = new Set([
          ...bdColumnsMap.keys(),
          ...entityColumnsMap.keys(),
        ]);

        allColumnNames.forEach((colName) => {
          const bdCol = bdColumnsMap.get(colName);
          const entityCol = entityColumnsMap.get(colName);

          if (!entityCol) {
            colDiffs.push({
              actionType: 'DELETE',
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              //@ts-ignore
              colName: bdCol!.name,
            });
          } else if (!bdCol) {
            this.createNewColumn(entityCol, colDiffs);
          } else this.diffColumnSql(bdCol, entityCol, colDiffs);
        });

        this.checkIndexes(bdTable, entityTable, colDiffs);

        if (colDiffs.length > 0) {
          diffs.push({
            tableName: tableName,
            schema: entityTable.schema ?? 'public',
            colDiffs,
          });
        }
      }
    });

    return diffs;
  }

  private checkIndexes(
    bdTable: SnapshotTable | undefined,
    entityTable: SnapshotTable | undefined,
    colDiffs: ColDiff[],
  ) {
    if ((bdTable && bdTable.indexes) || (entityTable && entityTable.indexes)) {
      if (!bdTable || !bdTable.indexes) {
        colDiffs.push({
          actionType: 'INDEX',
          colName: '*',
          indexTables: entityTable!.indexes.map((index) => ({
            name: index.indexName,
            properties: index.columnName.split(','),
          })),
        });
      }
      if (!entityTable || !entityTable.indexes) {
        colDiffs.push({
          actionType: 'INDEX',
          colName: '*',
          indexTables: bdTable!.indexes.map((index) => ({ name: index.indexName })),
        });
      }
    }

    if (bdTable && bdTable.indexes && entityTable && entityTable.indexes) {
      const bdIndexesMap = new Map(
        bdTable.indexes.map((index) => [index.indexName, index]),
      );
      const entityIndexesMap = new Map(
        entityTable.indexes.map((index) => [index.indexName, index]),
      );
      const allIndexes = new Set([
        ...bdIndexesMap.keys(),
        ...entityIndexesMap.keys(),
      ]);
      allIndexes.forEach((indexName) => {
        const bdIndex = bdIndexesMap.get(indexName);
        const entityIndex = entityIndexesMap.get(indexName);

        if (!entityIndex) {
          colDiffs.push({
            actionType: 'INDEX',
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            //@ts-ignore
            colName: bdIndex!.columnName,
            indexTables: [{ name: indexName }],
          });
        } else if (!bdIndex) {
          colDiffs.push({
            actionType: 'INDEX',
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            //@ts-ignore
            colName: entityIndex.columnName,
            indexTables: [
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              //@ts-ignore
              { name: indexName, properties: entityIndex.columnName.split(',') },
            ],
          });
        }
      });
    }
  }

  private createNewColumn(entityCol: ColumnsInfo, colDiffs: ColDiff[]): ColDiff[] {
    const colType = this.convertEntityTypeToSqlType(entityCol.type);

    colDiffs.push({
      actionType: 'CREATE',
      colName: entityCol.name,
      colType: colType.type,
      colLength: entityCol.length ?? colType.len,
      colChanges: {
        autoIncrement: entityCol.autoIncrement,
        default: entityCol.default,
        primary: entityCol.primary,
        unique: entityCol.unique,
        nullable: entityCol.nullable,
        enumItems: entityCol.enumItems,
        foreignKeys: entityCol.foreignKeys ?? undefined,
        precision: entityCol.precision ?? undefined,
        scale: entityCol.scale ?? undefined,
      },
    });

    return colDiffs;
  }

  private diffColumnType(
    bdCol: ColumnsInfo,
    entityCol: ColumnsInfo,
    colDiffs: ColDiff[],
  ): void {
    // if (bdCol.type === 'integer' && bdCol.primary) {
    //   bdCol.type = 'numeric';
    //   bdCol.length = 11;
    // }
    const isPostgres = this.driver instanceof PgDriver;

    if (bdCol.type === 'USER-DEFINED') {
      bdCol.type = 'enum';
    }

    const colT = this.convertEntityTypeToSqlType(entityCol.type);
    const colType = colT.type;
    let length = entityCol.length ?? colT.len;

    if (colType === 'integer' && isPostgres) {
      length = 32;
    }

    if (bdCol.isDecimal && isPostgres) {
      bdCol.type = 'decimal';
      length = bdCol.precision ?? 0;
    }

    if (!bdCol.type.includes(colType) || bdCol.length !== length) {
      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colType: colType,
        colLength: length,
        colChanges: {
          enumItems: entityCol.enumItems || undefined,
          precision: entityCol.precision ?? undefined,
          scale: entityCol.scale ?? undefined,
        },
      });
    }
  }

  private diffColumnDefault(
    bdCol: ColumnsInfo,
    entityCol: ColumnsInfo,
    colDiffs: ColDiff[],
  ): void {
    if (bdCol.default !== (entityCol.default ?? null)) {
      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colChanges: { default: entityCol.default },
        colLength: entityCol.length,
      });
    }
  }

  private diffColumnPrimary(
    bdCol: ColumnsInfo,
    entityCol: ColumnsInfo,
    colDiffs: ColDiff[],
  ): void {
    if (bdCol.primary !== (entityCol.primary ?? false)) {
      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colChanges: { primary: entityCol.primary },
        colLength: entityCol.length,
      });
    }
  }

  private diffColumnUnique(
    bdCol: ColumnsInfo,
    entityCol: ColumnsInfo,
    colDiffs: ColDiff[],
  ): void {
    if (bdCol.unique !== (entityCol.unique ?? false)) {
      if (bdCol.unique === false && entityCol.unique === undefined) {
        return;
      }

      if (entityCol.primary) {
        return;
      }

      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colChanges: { unique: entityCol.unique || false },
        colLength: entityCol.length,
      });
    }
  }

  private diffForeignKey(
    bdCol: ColumnsInfo,
    entityCol: ColumnsInfo,
    colDiffs: ColDiff[],
  ): void {
    if (bdCol.foreignKeys || entityCol.foreignKeys) {
      const bdFKMap = new Map(
        (bdCol.foreignKeys || []).map((fk) => [
          `${fk.referencedTableName}.${fk.referencedColumnName}`,
          fk,
        ]),
      );
      const entityFKMap = new Map(
        (entityCol.foreignKeys || []).map((fk) => [
          `${fk.referencedTableName}.${fk.referencedColumnName}`,
          fk,
        ]),
      );

      const allFKs = new Set([...bdFKMap.keys(), ...entityFKMap.keys()]);

      allFKs.forEach((fkName) => {
        const bdFK = bdFKMap.get(fkName);
        const entityFK = entityFKMap.get(fkName);

        if (!entityFK) {
          const fks = bdCol.foreignKeys?.filter((fk: any) => fk !== bdFK);
          colDiffs.push({
            actionType: 'ALTER',
            colName: bdCol.name,
            colChanges: {
              foreignKeys: fks.length > 0 ? fks : [],
            },
          });
        }
        // else if (!bdFK) {
        //   colDiffs.push({
        //     actionType: 'ALTER',
        //     colName: entityCol.name,
        //     colChanges: {
        //       foreignKeys: [...(bdCol.foreignKeys || []), entityFK],
        //     },
        //   });
        // }
      });
    }
  }

  private diffColumnSql(
    bdCol: ColumnsInfo,
    entityCol: ColumnsInfo,
    colDiffs: ColDiff[],
  ) {
    this.diffForeignKey(bdCol, entityCol, colDiffs);
    this.diffEnum(bdCol, entityCol, colDiffs);
    this.diffColumnType(bdCol, entityCol, colDiffs);
    this.diffColumnDefault(bdCol, entityCol, colDiffs);
    this.diffColumnPrimary(bdCol, entityCol, colDiffs);
    this.diffColumnUnique(bdCol, entityCol, colDiffs);
    this.diffColumnNullable(bdCol, entityCol, colDiffs);
    this.diffColumnPrecisionAndScale(bdCol, entityCol, colDiffs);

    return colDiffs;
  }

  diffColumnPrecisionAndScale(
    bdCol: ColumnsInfo,
    entityCol: ColumnsInfo,
    colDiffs: ColDiff[],
  ) {
    const bdPrecision = bdCol.precision ?? 0;
    const entityPrecision = entityCol.precision ?? bdPrecision;
    const bdScale = bdCol.scale ?? 0;
    const entityScale = entityCol.scale ?? bdCol.scale;

    if (
      bdCol.isDecimal &&
      (bdPrecision !== entityPrecision ||
        (bdCol.isDecimal && bdScale !== entityScale))
    ) {
      colDiffs.push({
        actionType: 'ALTER',
        colType: 'decimal',
        colName: entityCol.name,
        colChanges: {
          precision: entityCol.precision ?? 0,
          scale: entityCol.scale ?? 0,
        },
        colLength: entityCol.length,
      });
    }
  }

  private diffColumnNullable(
    bdCol: ColumnsInfo,
    entityCol: ColumnsInfo,
    colDiffs: ColDiff[],
  ) {
    if (bdCol.nullable !== (entityCol.nullable ?? false)) {
      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colChanges: { nullable: entityCol.nullable ?? false },
        colLength: entityCol.length,
      });
    }
  }

  // TODO: Precisa ser de acordo com o driver
  // adicionar  'varchar' | 'text' | 'int' | 'bigint' | 'float' | 'double' | 'decimal' | 'date' | 'datetime' | 'time' | 'timestamp' | 'boolean' | 'json' | 'jsonb' | 'enum' | 'array' | 'uuid'
  private convertEntityTypeToSqlType(entityType: string): {
    type: string;
    len?: number;
  } {
    switch (entityType) {
      case 'Number':
      case 'int':
        return { type: 'integer', len: 32 };
      case 'bigint':
        return { type: 'bigint' };
      case 'float':
      case 'double':
      case 'decimal':
        return { type: 'decimal' };
      case 'String':
      case 'varchar':
        return { type: 'character varying', len: 255 };
      case 'Boolean':
        return { type: 'boolean', len: null };
      case 'Date':
        return { type: 'timestamp' };
      case 'Object':
        return { type: 'json', len: null };
      case 'uuid':
        return { type: 'uuid', len: null };
      case 'text':
        return { type: 'text' };
      case 'enum':
        return { type: 'enum', len: null };
      default:
        return { type: 'character varying', len: 255 };
      //... mais casos aqui ...
    }
  }

  private diffEnum(bdCol: ColumnsInfo, entityCol: ColumnsInfo, colDiffs: ColDiff[]) {
    if (bdCol.enumItems || entityCol.enumItems) {
      if (bdCol.enumItems && entityCol.enumItems) {
        const allEnums = new Set([...bdCol.enumItems, ...entityCol.enumItems]);
        const differences = [...allEnums].filter(
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          //@ts-ignore
          (x) => !bdCol.enumItems?.includes(x) || !entityCol.enumItems?.includes(x),
        );

        if (differences.length === 0) {
          return;
        }

        colDiffs.push({
          actionType: 'ALTER',
          colName: entityCol.name,
          colType: 'enum',
          colChanges: {
            enumItems: entityCol.enumItems,
          },
        });
      }

      if (!entityCol.enumItems) {
        // colDiffs.push({
        //   actionType: 'DELETE',
        //   colName: bdCol.name,
        //   colChanges: {
        //     enumItems: [],
        //   },
        // });
      } else if (!bdCol.enumItems) {
        colDiffs.push({
          actionType: 'CREATE',
          colName: entityCol.name,
          colChanges: {
            enumItems: entityCol.enumItems,
          },
        });
      }
    }
  }
}
