#!/usr/bin/env node
import { Command } from 'commander';

declare const program: Command;
declare function runOpenBoxCli(argv?: string[]): Promise<void>;

export { program, runOpenBoxCli };
