import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const run = (...args: string[]) => spawnSync('node', ['src/cli.ts', ...args], { encoding: 'utf8' });

const dir = mkdtempSync(join(tmpdir(), 'estorm-'));
afterAll(() => rmSync(dir, { recursive: true }));

let fixtures = 0;
function fixture(text: string): string {
  const file = join(dir, `board-${++fixtures}.estorm`);
  writeFileSync(file, text);
  return file;
}

describe('cli', () => {
  it('renders next to the input', () => {
    const file = fixture('A: Do -> Done');
    const { status } = run('render', file);
    expect(status).toBe(0);
    expect(readFileSync(file.replace(/\.estorm$/, '.svg'), 'utf8')).toMatch(/^<svg/);
  });

  it('renders to stdout', () => {
    const { status, stdout } = run('render', fixture('A: Do -> Done'), '-o', '-');
    expect(status).toBe(0);
    expect(stdout).toMatch(/^<svg/);
  });

  it('reports errors as file:line: message', () => {
    const file = fixture('A: Do -> Done\n  then Oops');
    const { status, stderr } = run('check', file);
    expect(status).toBe(1);
    expect(stderr.trim()).toBe(`${file}:2: chain must end with an event`);
  });

  it('summarises to stdout', () => {
    const { status, stdout } = run('summary', fixture('A: Do -> Done'));
    expect(status).toBe(0);
    expect(stdout).toContain('## Actors\n\nCommands each actor or schedule issues.\n\n- A: Do\n');
  });

  it('heads each summary with its file when there are several', () => {
    const [a, b] = [fixture('Started'), fixture('Stopped')];
    const { status, stdout } = run('summary', a, b);
    expect(status).toBe(0);
    expect(stdout).toContain(`# ${a}\n\n## Events`);
    expect(stdout).toContain(`\n\n# ${b}\n\n## Events`);
  });

  it('reports missing files', () => {
    const { status, stderr } = run('check', 'nope.estorm');
    expect(status).toBe(1);
    expect(stderr.trim()).toBe('nope.estorm: no such file');
  });

  it('reports directories', () => {
    const { status, stderr } = run('check', 'examples');
    expect(status).toBe(1);
    expect(stderr.trim()).toBe('examples: is a directory');
  });

  it('rejects ports out of range', () => {
    const { status, stderr } = run('serve', 'examples/hotel.estorm', '-p', '70000');
    expect(status).toBe(2);
    expect(stderr).toContain('invalid port: 70000');
  });

  it('explains usage errors', () => {
    const { status, stderr } = run('frobnicate');
    expect(status).toBe(2);
    expect(stderr).toContain('unknown command: frobnicate');
    expect(stderr).toContain('Usage:');
  });

  it('prints the version', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(run('--version').stdout.trim()).toBe(pkg.version);
  });
});
