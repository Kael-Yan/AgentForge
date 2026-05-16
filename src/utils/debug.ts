/** Simple debug logger — replace with structured logging in production */
export function logForDebugging(message: string): void {
  if (process.env.DEBUG) {
    process.stderr.write(`[DEBUG] ${message}\n`)
  }
}
