export const platformAdapter = Object.freeze({
  id: 'linux',
  platform: 'linux',
  serviceManager: 'systemd',
  scheduler: 'systemd-timer',
  pathStyle: 'posix',
  capabilities: ['systemd', 'systemd-timer', 'posix-signals'],
});
export default platformAdapter;
