import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { RegistrationsService } from './registrations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard/jwt-auth.guard';

type AuthedRequest = Request & { user: { userId: string } };

@Controller('events/:eventId/registrations')
export class RegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Param('eventId') eventId: string, @Req() req: AuthedRequest) {
    return this.registrationsService.create(eventId, req.user.userId);
  }
}