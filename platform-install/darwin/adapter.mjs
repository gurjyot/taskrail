export const platformAdapter = Object.freeze({
  id: 'macos',
  platform: 'darwin',
  serviceManager: 'launchd',
  scheduler: 'launchd',
  pathStyle: 'posix',
  capabilities: ['launchd', 'posix-signals'],
});
export default platformAdapter;
