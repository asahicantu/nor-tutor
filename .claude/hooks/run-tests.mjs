// PostToolUse hook: run the unit tests after a .js edit under src/ or tests/; exit 2 feeds failures back to Claude.
import { spawnSync } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const file = JSON.parse(input).tool_input?.file_path ?? '';
if (!/[\\/](src|tests)[\\/].*\.js$/.test(file)) process.exit(0);

const r = spawnSync(process.execPath, ['--test'], { cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), encoding: 'utf8' });
if (r.status !== 0) {
  process.stderr.write(`npm test failed after editing ${file}:\n${(r.stdout + r.stderr).slice(-4000)}`);
  process.exit(2);
}
