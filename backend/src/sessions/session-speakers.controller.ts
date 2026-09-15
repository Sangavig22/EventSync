import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';

@Controller('sessions/:sessionId/speakers')
export class SessionSpeakersController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post(':speakerId')
  assignSpeaker(
    @Param('sessionId') sessionId: string,
    @Param('speakerId') speakerId: string,
  ) {
    return this.sessionsService.assignSpeaker(sessionId, speakerId);
  }

  @Get()
  listSpeakers(@Param('sessionId') sessionId: string) {
    return this.sessionsService.listSpeakers(sessionId);
  }

  @Delete(':speakerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unassignSpeaker(
    @Param('sessionId') sessionId: string,
    @Param('speakerId') speakerId: string,
  ) {
    await this.sessionsService.unassignSpeaker(sessionId, speakerId);
  }
}