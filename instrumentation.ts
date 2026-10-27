export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkEnvironment, resumeBackgroundWork } = await import('./lib/server/startup');
  checkEnvironment();
  resumeBackgroundWork();
}
