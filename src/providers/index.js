import { MockProvider } from './mock.js';
import { SystemdProvider } from './systemd.js';
import { DockerProvider } from './docker.js';

// Factory: add a provider here and select it with PROVIDER=<name>.
const REGISTRY = {
  mock: () => new MockProvider(),
  systemd: () => new SystemdProvider(),
  docker: () => new DockerProvider(),
};

export function createProvider(name) {
  const make = REGISTRY[name];
  if (!make) throw new Error(`Unknown PROVIDER "${name}". Options: ${Object.keys(REGISTRY).join(', ')}`);
  return make();
}
