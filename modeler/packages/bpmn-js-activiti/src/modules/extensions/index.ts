import { ExtensionsBehavior } from './ExtensionsBehavior';
import { ExtensionsCommands } from './ExtensionsCommands';
import { ExtensionsStore } from './ExtensionsStore';

export { ExtensionsBehavior, processIdOf } from './ExtensionsBehavior';
export { ExtensionsCommands } from './ExtensionsCommands';
export { EXTENSIONS_CHANGED, ExtensionsStore, type DefaultMappings, type ExtensionsConfig, type Mutation, type MutationContext } from './ExtensionsStore';

/** didi module: the `extensionsStore` service, its command handlers and the interceptor that keeps keys in sync. */
export const ExtensionsModule = {
  __init__: ['extensionsCommands', 'extensionsBehavior'],
  extensionsStore: ['type', ExtensionsStore],
  extensionsCommands: ['type', ExtensionsCommands],
  extensionsBehavior: ['type', ExtensionsBehavior],
};
