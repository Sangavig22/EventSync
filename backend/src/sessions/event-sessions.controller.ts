import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';

@Controller('events/:eventId/sessions')
export class EventSessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  create(
    @Param('eventId') eventId: string,
    @Body() createSessionDto: CreateSessionDto,
  ) {
    return this.sessionsService.create(eventId, createSessionDto);
  }

  @Get()
  findAllByEvent(@Param('eventId') eventId: string) {
    return this.sessionsService.findAllByEvent(eventId);
  }
}