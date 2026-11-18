import type { DependencyManager, Module } from '@credo-ts/core'

import { OpenId4VcStatusListEntryRepository } from './StatusListEntryRecord'
import { OpenId4VcStatusListRepository } from './StatusListRecord'

/**
 * Registers the repositories of the Token Status Lists and of their index bindings on the agent, so
 * that both live in the agent storage ([VSA-DATA]) next to the issuance sessions they belong to.
 */
export class OpenId4VcStatusListStorageModule implements Module {
  public register(dependencyManager: DependencyManager): void {
    dependencyManager.registerSingleton(OpenId4VcStatusListRepository)
    dependencyManager.registerSingleton(OpenId4VcStatusListEntryRepository)
  }
}
