import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { EventSessionsController } from './event-sessions.controller';
import { SessionSpeakersController } from './session-speakers.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [
    SessionsController,
    EventSessionsController,
    SessionSpeakersController,
  ],
  providers: [SessionsService],
})
export class SessionsModule {}