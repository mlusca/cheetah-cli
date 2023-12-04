import { Metadata } from '@cheetah.js/core';
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { v4 } from 'uuid';
import {
  BaseEntity,
  Email,
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Enum,
} from '@cheetah.js/orm';
import { Migrator } from 'src/migrator/migrator';
import { execute, mockLogger, purgeDatabase, startDatabase } from './node-database';

describe('error on length', () => {
  beforeEach(async () => {
    await startDatabase();
    Metadata.delete('cheetah:entities', Reflect);
  });

  afterEach(async () => {
    await purgeDatabase();
    (mockLogger as jest.Mock).mockClear();
  });

  test('When search de config file', async () => {
    const migrator = new Migrator();
    expect(async () => {
      await migrator.generateMigration('src');
    }).toThrow('Config file not found');
  });

  test('should snapshot database', async () => {
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property({ unique: true })
      email: string;
    }

    Entity()(User);
    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      'create table "public"."user" ("id" integer not null, "email" varchar(255) not null, constraint "user_pkey" primary key ("id"));',
      'alter table "public"."user" add constraint "user_email_key" unique ("email");',
    ]);
    await execute(sql.join('\n'));
  });

  test('should modify database column', async () => {
    await execute(
      'CREATE TABLE "public"."user" ("id" integer PRIMARY KEY,"email" character varying(255) UNIQUE);',
    );
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property()
      email: string;

      @Property({ length: 10 })
      password: string;

      @Property({ nullable: true })
      token?: string;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      'alter table "public"."user" add column "password" varchar(10) not null, add column "token" varchar(255) null;',
      'alter table "public"."user" drop constraint "user_email_key";',
    ]);

    await execute(sql.join('\n'));
  });

  test('should modify a column unique', async () => {
    await execute(
      'CREATE TABLE "public"."user" ("id" integer NOT NULL PRIMARY KEY,"email" character varying(255) NOT NULL unique, "password" character varying(10) NOT NULL);',
    );
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property()
      email: string;

      @Property({ length: 10, unique: true })
      password: string;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      'alter table "public"."user" drop constraint "user_email_key";',
      'alter table "public"."user" add constraint "user_password_key" unique ("password");',
    ]);

    await execute(sql.join('\n'));
  });

  test('should add a relation property', async () => {
    await execute(
      'CREATE TABLE "public"."user" ("id" integer NOT NULL PRIMARY KEY,"email" character varying(255) NOT NULL unique);',
    );
    await execute(
      'CREATE TABLE "public"."address" ("id" integer NOT NULL PRIMARY KEY);',
    );
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property()
      email: string;
    }

    class Address extends BaseEntity {
      @PrimaryKey()
      id: number;

      @ManyToOne(() => User)
      user: User;
    }

    Entity()(User);
    Entity()(Address);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      'alter table "public"."user" drop constraint "user_email_key";',
      'alter table "public"."address" add column "user_id" integer not null;',
      'alter table "public"."address" add constraint "address_user_id_fk" foreign key ("user_id") references "user" ("id");',
    ]);

    await execute(sql.join('\n'));
  });

  test('should add a relation property', async () => {
    await execute(
      'CREATE TABLE "public"."user" ("id" integer NOT NULL PRIMARY KEY,"email" character varying(255) NOT NULL);',
    );
    await execute(
      'CREATE TABLE "public"."address" ("id" integer NOT NULL PRIMARY KEY, "user" integer NOT NULL);',
    );
    await execute(
      'ALTER TABLE "public"."address" ADD CONSTRAINT "address_user_fk" FOREIGN KEY ("user") REFERENCES "public"."user" ("id");',
    );

    class User extends BaseEntity {
      @PrimaryKey() 
      id: number;

      @Property()
      email: string;
    }

    class Address extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property({ length: 11, nullable: true })
      user: number;
    }

    Entity()(User);
    Entity()(Address);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'alter table "public"."address" drop constraint "address_user_fk";',
      'alter table "public"."address" alter column "user" drop not null;',
    ]);
    await execute(sql.join('\n'));
  });

  test('should add a index property with multiple indexes', async () => {
    await execute(
      'CREATE TABLE "public"."user" ("id" integer NOT NULL PRIMARY KEY,"email" character varying(255) NOT NULL);',
    );

    class User extends BaseEntity {
      @PrimaryKey()
      @Index({ properties: ['id', 'email'] })
      id: number;

      @Property()
      @Index()
      email: string;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'create index "id_email_index" on "public"."user" ("id", "email");',
      'create index "email_index" on "public"."user" ("email");',
    ]);
    await execute(sql.join('\n'));
  });

  test('should add a create with relations', async () => {
    class User extends BaseEntity {
      @PrimaryKey()
      @Index({ properties: ['id', 'email'] })
      id: number;

      @Property()
      @Index()
      email: string;
    }

    class Address extends BaseEntity {
      @PrimaryKey()
      id: number;

      @ManyToOne(() => User)
      user: User;
    }

    Entity()(User);
    Entity()(Address);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'create table "public"."user" ("id" integer not null, "email" varchar(255) not null, constraint "user_pkey" primary key ("id"));',
      'create index "id_email_index" on "public"."user" ("id", "email");',
      'create index "email_index" on "public"."user" ("email");',
      'create table "public"."address" ("id" integer not null, "user_id" integer not null, constraint "address_pkey" primary key ("id"));',
      'alter table "public"."address" add constraint "address_user_id_fk" foreign key ("user_id") references "user" ("id");',
    ]);
    await execute(sql.join('\n'));
  });

  test('should create with value-objects', async () => {
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property({ dbType: 'text' })
      email: Email;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'create table "public"."user" ("id" integer not null, "email" text not null, constraint "user_pkey" primary key ("id"));',
    ]);
    await execute(sql.join('\n'));
  });

  test('should create with auto-increment', async () => {
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Property({ dbType: 'text' })
      email: Email;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'create table "public"."user" ("id" serial primary key, "email" text not null);',
    ]);
    await execute(sql.join('\n'));
  });

  test('should create with enum property', async () => {
    enum Role {
      ADMIN = 'admin',
      USER = 'user',
    }
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Enum(() => Role)
      role: Role;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'create table "public"."user" ("id" serial primary key, "role" text check ("role" in (\'admin\', \'user\')) not null);',
    ]);
    await execute(sql.join('\n'));
  });

  test('should alter property to enum property', async () => {
    const DDL = `
        CREATE TABLE "public"."user" ("id" SERIAL PRIMARY KEY UNIQUE,"role" character varying(255) NOT NULL UNIQUE);
    `;
    await execute(DDL);
    enum Role {
      ADMIN = 'admin',
      USER = 'user',
    }
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Enum(() => Role)
      role: Role;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'alter table "public"."user" alter column "role" drop default;',
      'alter table "public"."user" alter column "role" type text using ("role"::text);',
      'alter table "public"."user" add constraint role_check check("role" in (\'admin\',\'user\'));',
      'alter table "public"."user" drop constraint "user_role_key";',
    ]);
    await execute(sql.join('\n'));
  });

  test('should alter property enum values', async () => {
    const DDL = `
        CREATE TYPE "public_user_role_enum" AS ENUM ('admin', 'user');
        CREATE TABLE "public"."user" ("id" SERIAL PRIMARY KEY UNIQUE,"role" public_user_role_enum NOT NULL);
    `;
    await execute(DDL);
    enum Role {
      ADMIN = 'admin',
      USER = 'user',
      MODERATOR = 'moderator',
    }
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Enum(() => Role)
      role: Role;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'alter table "public"."user" alter column "role" drop default;',
      'alter table "public"."user" alter column "role" type text using ("role"::text);',
      'alter table "public"."user" add constraint role_check check("role" in (\'admin\',\'user\',\'moderator\'));',
    ]);
    await execute(sql.join('\n'));
  });

  test('should alter property enum to string', async () => {
    const DDL = `
        CREATE TYPE "public_user_role_enum" AS ENUM ('admin', 'user');
        CREATE TABLE "public"."user" ("id" SERIAL PRIMARY KEY UNIQUE,"role" public_user_role_enum NOT NULL);
    `;
    await execute(DDL);
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Property()
      role: string;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'alter table "public"."user" alter column "role" drop default;',
      'alter table "public"."user" alter column "role" type varchar(255) using ("role"::varchar(255));',
    ]);
    await execute(sql.join('\n'));
  });

  test('1', async () => {
    class User extends BaseEntity {
      @Property({ length: 100 })
      username: string;

      @Property({ index: true, unique: true })
      email: string;

      @Property({ hidden: true, length: 20 })
      password: string;

      @Property({ index: true })
      token?: string;

      @Property()
      newColumn?: string;

      @PrimaryKey({ dbType: 'uuid' })
      id: string = v4();

      @Property({ length: 3 })
      createdAt: Date = new Date();

      @Property({ length: 3, onUpdate: () => new Date() })
      updatedAt: Date = new Date();
    }

    await execute(
      '' +
        'CREATE TABLE "public"."user" ("id" uuid NOT NULL PRIMARY KEY UNIQUE,"created_at" timestamp(3) NOT NULL,"updated_at" timestamp(3) NOT NULL,"username" character varying(255) NOT NULL,"email" character varying(255) NOT NULL UNIQUE,"password" character varying(255) NOT NULL,"token" character varying(255));' +
        'CREATE INDEX "email_index" ON "public"."user" ("email");' +
        'CREATE INDEX "token_index" ON "public"."user" ("token");',
    );

    Entity()(User);
    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);
    expect(sql).toEqual([
      'alter table "public"."user" add column "new_column" varchar(255) not null;',
      'alter table "public"."user" alter column "username" drop default;',
      'alter table "public"."user" alter column "username" type varchar(100) using ("username"::varchar(100));',
      'alter table "public"."user" alter column "password" drop default;',
      'alter table "public"."user" alter column "password" type varchar(20) using ("password"::varchar(20));',
    ]);
    await execute(sql.join('\n'));
  });

  test('2', async () => {
    class User extends BaseEntity {
      @Property()
      username: string;

      @Property({ hidden: true, length: 20 })
      password: number;

      @PrimaryKey({ dbType: 'uuid' })
      id: string = v4();

      @Property({ length: 3 })
      createdAt: Date = new Date();

      @Property({ length: 3, onUpdate: () => new Date() })
      updatedAt: Date = new Date();
    }

    await execute(
      '' +
        'CREATE TABLE "public"."user" ("id" uuid NOT NULL PRIMARY KEY UNIQUE,"created_at" timestamp(3) NOT NULL,"updated_at" timestamp(3) NOT NULL,"username" character varying(255) NOT NULL,"email" character varying(255) NOT NULL UNIQUE,"password" character varying(255) NOT NULL,"token" character varying(255));' +
        'CREATE INDEX "email_index" ON "public"."user" ("email");' +
        'CREATE INDEX "token_index" ON "public"."user" ("token");',
    );

    Entity()(User);
    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      'alter table "public"."user" alter column "password" drop default;',
      'alter table "public"."user" alter column "password" type integer using ("password"::integer);',
      'alter table "public"."user" drop column "email";',
      'alter table "public"."user" drop column "token";',
    ]);
    await execute(sql.join('\n'));
  });

  test('should snapshot database with propertyCamelcase', async () => {
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Property()
      createdAt: Date;

      @ManyToOne(() => User)
      userOwner: User[];
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      'create table "public"."user" ("id" serial primary key, "created_at" timestamptz not null, "user_owner_id" integer not null);',
      'alter table "public"."user" add constraint "user_user_owner_id_fk" foreign key ("user_owner_id") references "user" ("id");',
    ]);
    await execute(sql.join('\n'));
  });

  test('should snapshot database with decimal value', async () => {
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Property({ length: 3 })
      createdAt: Date;

      @Property({ dbType: 'decimal', precision: 4, scale: 2 })
      money: number;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      "create table \"public\".\"user\" (\"id\" serial primary key, \"created_at\" timestamptz(3) not null, \"money\" decimal(4, 2) not null);"
    ]);
    await execute(sql.join('\n'));
  });

  test('should change the precision or scale', async () => {
    await execute(
      "create table \"public\".\"user\" (\"id\" serial primary key, \"created_at\" timestamptz(3) not null, \"money\" decimal(4, 2) not null);"
    )
    
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Property({ length: 3 })
      createdAt: Date;

      @Property({ dbType: 'decimal', precision: 7, scale: 3 })
      money: number;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      "alter table \"public\".\"user\" alter column \"money\" drop default;",
      "alter table \"public\".\"user\" alter column \"money\" type decimal(7, 3) using (\"money\"::decimal(7, 3));"
    ]);
    await execute(sql.join('\n'));
  });

  test('should add float column', async () => {
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Property({ length: 3 })
      createdAt: Date;

      @Property({ dbType: 'float', precision: 10 })
      money: number;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      "create table \"public\".\"user\" (\"id\" serial primary key, \"created_at\" timestamptz(3) not null, \"money\" decimal(10, 2) not null);"
    ]);
    await execute(sql.join('\n'));
  });

  test('should alter float column', async () => {
    await execute("create table \"public\".\"user\" (\"id\" serial primary key, \"created_at\" timestamptz(3) not null, \"money\" decimal(10, 2) not null);")

    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Property({ length: 3 })
      createdAt: Date;

      @Property({ dbType: 'float', precision: 10, scale: 3 })
      money: number;
    }

    Entity()(User);

    const migrator = new Migrator();
    const sql = await migrator.generateMigration(process.cwd(), true);

    expect(sql).toEqual([
      "alter table \"public\".\"user\" alter column \"money\" drop default;",
      "alter table \"public\".\"user\" alter column \"money\" type decimal(10, 3) using (\"money\"::decimal(10, 3));"
    ]);
    await execute(sql.join('\n'));
  });
});
