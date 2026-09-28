import { describe, expect, it } from 'vitest'

import {
  ConnectionsRepository,
  ConnectionsService,
  CredentialService,
  EventHandler,
  EventsController,
  EventsModule,
  EventsService,
  StatProducerService,
  VS_AGENT_CLIENT,
} from '../src'

class Handler implements EventHandler {
  public newConnection(): void {}
  public closeConnection(): void {}
  public onEvent(): void {}
}

describe('EventsModule', () => {
  it('registers the controller, the client and the events service with no optional module', () => {
    const module = EventsModule.register({ url: 'http://example.com', eventHandler: Handler })

    expect(module.controllers).toEqual([EventsController])
    expect(module.providers).toContain(EventsService)
    expect(module.exports).toEqual([VS_AGENT_CLIENT])
    expect(module.providers).not.toContain(ConnectionsService)
    expect(module.providers).not.toContain(CredentialService)
    expect(module.providers).not.toContain(StatProducerService)
  })

  it('registers and exports each optional module', () => {
    const module = EventsModule.register({
      url: 'http://example.com',
      eventHandler: Handler,
      modules: { connections: { requireProfile: false }, credentials: true, stats: true },
    })

    expect(module.providers).toEqual(
      expect.arrayContaining([
        ConnectionsRepository,
        ConnectionsService,
        CredentialService,
        StatProducerService,
      ]),
    )
    expect(module.exports).toEqual([
      VS_AGENT_CLIENT,
      ConnectionsRepository,
      ConnectionsService,
      CredentialService,
      StatProducerService,
    ])
  })
})
