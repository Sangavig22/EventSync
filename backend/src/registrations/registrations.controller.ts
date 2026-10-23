import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { RegistrationsService } from './registrations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { OrganizationFromEvent } from '../common/decorators/organization-context.decorator';
import { Permission } from '../common/authorization/permissions';

type AuthedRequest = Request & { user: { userId: string } };

@Controller('events/:eventId/registrations')
export class RegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Param('eventId') eventId: string, @Req() req: AuthedRequest) {
    return this.registrationsService.create(eventId, req.user.userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromEvent('eventId')
  @RequirePermissions(Permission.EVENT_READ)
  findByEvent(@Param('eventId') eventId: string) {
    return this.registrationsService.findByEvent(eventId);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  cancel(@Param('eventId') eventId: string, @Req() req: AuthedRequest) {
    return this.registrationsService.cancel(eventId, req.user.userId);
  }
}