import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { StatEnum, StatEvent } from '@verana-labs/vs-agent-model'
import { Container, Connection, Sender, create_container } from 'rhea'

import { EVENTS_MODULE_OPTIONS } from '../tokens'
import { EventsModuleOptions } from '../types'

@Injectable()
export class StatProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatProducerService.name)
  private connection: Connection | null = null
  private sender: Sender | null = null
  private container: Container

  private readonly config: {
    host: string
    port: number
    queue: string
    username: string
    password: string
    reconnectLimit: number
    threads: number
    delay: number
  }

  /**
   * Initializes the StatProducerService with default settings optimized for a local development environment.
   * By default, it connects to a JMS broker running on `localhost` with predefined credentials.
   *
   * If custom options are provided through `EVENTS_MODULE_OPTIONS`, they will override the defaults.
   *
   * @param options - Configuration options for the JMS connection.
   */
  constructor(@Inject(EVENTS_MODULE_OPTIONS) options: EventsModuleOptions) {
    this.container = create_container()
    this.config = {
      host: options.statOptions?.host || 'localhost',
      port: options.statOptions?.port || 61616,
      queue: options.statOptions?.queue || 'stats-queue',
      username: options.statOptions?.username || 'quarkus',
      password: options.statOptions?.password || 'quarkus',
      reconnectLimit: options.statOptions?.reconnectLimit || 10,
      threads: options.statOptions?.threads || 1,
      delay: options.statOptions?.delay || 1000,
    }

    this.logger.log('StatProducerService instantiated')
  }

  async onModuleInit() {
    this.logger.log(`Initializing StatProducer with queue: ${this.config.queue}`)
    await this.connect()
  }

  async onModuleDestroy() {
    await this.disconnect()
  }

  private async connect() {
    try {
      this.connection = this.container.connect({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        reconnect: true,
        reconnect_limit: this.config.reconnectLimit,
      })

      this.sender = this.connection.open_sender(this.config.queue)

      this.sender.on('accepted', () => {
        this.logger.debug('Message accepted')
      })

      this.sender.on('rejected', context => {
        this.logger.error(`Message rejected: ${context.error}`)
      })

      this.logger.log('Successfully connected to ActiveMQ')
    } catch (error) {
      this.logger.error(`Failed to connect: ${error.message}`)
      throw error
    }
  }

  private async disconnect() {
    try {
      if (this.sender) {
        await this.sender.close()
      }
      if (this.connection) {
        await this.connection.close()
      }
      this.logger.log('Successfully disconnected from ActiveMQ')
    } catch (error) {
      this.logger.error(`Error disconnecting: ${error.message}`)
    }
  }

  /**
   * Sends a message of type `JMSTextMessage` as defined by the IBM MQ documentation:
   * https://www.ibm.com/docs/en/ibm-mq/9.4?topic=messaging-jmstextmessage.
   *
   * The method spools statistical events to a messaging system. If the sender
   * is not initialized, it attempts to reconnect. Each message contains the event
   * details serialized as a JSON string and is sent to the configured messaging queue.
   *
   * @param statClass - A string or array of strings representing the class of the statistic(s).
   * @param entityId - A unique identifier for the entity associated with the statistics.
   * @param statEnums - An array of statistical enums to send.
   * @param ts - The timestamp for the event (defaults to the current date and time).
   * @param increment - The increment value for the statistic (defaults to 1).
   * @throws If the sender cannot be initialized or if sending a message fails.
   */
  async spool(
    statClass: string | string[],
    entityId: string,
    statEnums: StatEnum[],
    ts: Date = new Date(),
    increment: number = 1,
  ): Promise<void> {
    // Check if the sender is initialized; if not, attempt to reconnect
    if (!this.sender) {
      this.logger.error('Sender is not initialized. Attempting to reconnect...')
      await this.connect()

      if (!this.sender) {
        throw new Error('Failed to initialize sender after reconnection attempt')
      }
    }
    const statClasses = Array.isArray(statClass) ? statClass : [statClass]

    // Iterate over each stat class and send a message for it
    for (const currentStatClass of statClasses) {
      const event = new StatEvent(entityId, statEnums, increment, ts, currentStatClass)

      try {
        const msg = {
          body: JSON.stringify(event),
        }
        this.sender.send(msg)
        this.logger.debug(`Sending message: ${msg.body}`)
      } catch (error) {
        this.logger.error(`Failed to send message: ${error.message}`)
        throw error
      }
    }
  }

  async spoolSingle(
    statClass: string,
    entityId: string,
    statEnum: StatEnum,
    ts: Date = new Date(),
    increment: number = 1,
  ): Promise<void> {
    await this.spool(statClass, entityId, [statEnum], ts, increment)
  }
}
