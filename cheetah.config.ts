import { ConnectionSettings, PgDriver } from '@cheetah.js/orm';

const config: ConnectionSettings = {
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: 'postgres',
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  driver: PgDriver,
  migrationPath: '/database/migration',
};

export default config;
