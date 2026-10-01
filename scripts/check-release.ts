/**
 * Run by `npm version` before it bumps anything: a release is cut from
 * `main`, matching GitHub, so the tag lands on what everyone else sees.
 */
import { execFileSync } from 'node:child_process';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const fail = (message: string) => {
  console.error(`check-release: ${message}`);
  process.exit(1);
};

if (git('branch', '--show-current') !== 'main') fail('release from main');
git('fetch', '--quiet', 'origin', 'main');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('main differs from origin/main; pull or push first');
