import { Module } from '@nestjs/common';
import { EventSessionsController } from './event-sessions.controller';
import { SessionSpeakersController } from './session-speakers.controller';
import { SessionsService } from './sessions.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [EventSessionsController, SessionSpeakersController],
  providers: [SessionsService],
})
export class SessionsModule {}