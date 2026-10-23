import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { RegistrationsService } from './registrations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard/jwt-auth.guard';

type AuthedRequest = Request & { user: { userId: string } };

@Controller('users/me/registrations')
@UseGuards(JwtAuthGuard)
export class UserRegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  @Get()
  findAll(@Req() req: AuthedRequest) {
    return this.registrationsService.findMine(req.user.userId);
  }
}