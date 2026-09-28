import { DynamicModule, Global, Module, Provider } from '@nestjs/common'
import { ApiClient } from '@verana-labs/vs-agent-client'

import { ConnectionsRepository, ConnectionsService } from './connections'
import { CredentialService } from './credentials'
import { EventsController } from './events.controller'
import { EventsService } from './events.service'
import { StatProducerService } from './jms'
import { EVENT_HANDLER, EVENTS_MODULE_OPTIONS, VS_AGENT_CLIENT } from './tokens'
import { EventsModuleOptions } from './types'

@Global()
@Module({})
export class EventsModule {
  public static register(options: EventsModuleOptions): DynamicModule {
    const { connections, credentials, stats } = options.modules ?? {}
    const providers: Provider[] = [
      { provide: EVENTS_MODULE_OPTIONS, useValue: options },
      { provide: EVENT_HANDLER, useClass: options.eventHandler },
      {
        provide: VS_AGENT_CLIENT,
        useFactory: (): ApiClient => new ApiClient(options.url, { token: options.token }),
      },
      EventsService,
    ]
    const exports: NonNullable<DynamicModule['exports']> = [VS_AGENT_CLIENT]

    if (connections) {
      providers.push(ConnectionsRepository, ConnectionsService)
      exports.push(ConnectionsRepository, ConnectionsService)
    }
    if (credentials) {
      providers.push(CredentialService)
      exports.push(CredentialService)
    }
    if (stats) {
      providers.push(StatProducerService)
      exports.push(StatProducerService)
    }

    return { module: EventsModule, controllers: [EventsController], providers, exports }
  }
}
