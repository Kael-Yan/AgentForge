import { join } from 'path'
import { homedir } from 'os'

/** Base directory for persistent memory/data */
export function getMemoryBaseDir(): string {
  return join(homedir(), '.multi-agent-cli')
}
