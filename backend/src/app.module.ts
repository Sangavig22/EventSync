import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './events/events.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { SessionsModule } from './sessions/sessions.module';
import { SpeakersModule } from './speakers/speakers.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';
import { OrdersModule } from './orders/orders.module';
import { AuthModule } from './auth/auth.module';
import { PaymentsModule } from './payments/payments.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

// Jest sets NODE_ENV=test. @nestjs/observe 0.1.8 leaves its detached worker
// thread running after shutdown (its exit handler respawns the worker on
// terminate's exit code 1), which keeps the test process alive; so the agent is
// not registered under test. Production wiring is unchanged.
const observeImports =
  process.env.NODE_ENV === 'test'
    ? []
    : [
        // Distributed tracing, auto-correlated logs, request/job metrics, error
        // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
        ObserveModule.forRoot({
          appKey: 'YOUR_APP_KEY',
          appSecret: 'YOUR_APP_SECRET',
          serviceId: 'backend',
        }),
      ];

@Module({
  imports: [
    ...observeImports,
    PrismaModule,
    EventsModule,
    OrganizationsModule,
    UsersModule,
    SessionsModule,
    SpeakersModule,
    RegistrationsModule,
    TicketTypesModule,
    OrdersModule,
    AuthModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
