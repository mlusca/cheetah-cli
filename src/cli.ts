#!/usr/bin/env node

import 'reflect-metadata';
import { Command } from 'commander';
import { Migrator } from './migrator/migrator';

const program = new Command();

program.name('[npx|bunx] cli').description('CLI to Cheetah.js ORM ');

program
  .command('migration:generate')
  .description('generate a new migration file with a diff')
  .action(async (str, options) => {
    const migrator = new Migrator();
    migrator.useTsNode();
    await migrator.generateMigration();
    process.exit(0);
  });

program
  .command('migration:run')
  .description('run all pending migrations')
  .action(async (str, options) => {
    const migrator = new Migrator();
    migrator.useTsNode();
    await migrator.migrate();
    process.exit(0);
  });

program.parse();
