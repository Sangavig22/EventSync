import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { OrganizationFromEvent } from '../common/decorators/organization-context.decorator';
import { Permission } from '../common/authorization/permissions';

@Controller('events/:eventId/sessions')
export class EventSessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromEvent('eventId')
  @RequirePermissions(Permission.SESSION_MANAGE)
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

  @Get(':sessionId')
  findOne(
    @Param('eventId') eventId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.sessionsService.findOneByEvent(eventId, sessionId);
  }

  @Patch(':sessionId')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromEvent('eventId')
  @RequirePermissions(Permission.SESSION_MANAGE)
  update(
    @Param('eventId') eventId: string,
    @Param('sessionId') sessionId: string,
    @Body() updateSessionDto: UpdateSessionDto,
  ) {
    return this.sessionsService.update(
      eventId,
      sessionId,
      updateSessionDto,
    );
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromEvent('eventId')
  @RequirePermissions(Permission.SESSION_MANAGE)
  async remove(
    @Param('eventId') eventId: string,
    @Param('sessionId') sessionId: string,
  ) {
    await this.sessionsService.remove(eventId, sessionId);
  }
}