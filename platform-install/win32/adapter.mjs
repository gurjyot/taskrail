export const platformAdapter = Object.freeze({
  id: 'windows',
  platform: 'win32',
  serviceManager: 'windows-service',
  scheduler: 'task-scheduler',
  pathStyle: 'win32',
  capabilities: ['windows-service', 'task-scheduler'],
});
export default platformAdapter;
