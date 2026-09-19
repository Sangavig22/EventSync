import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { OrganizationFromSession } from '../common/decorators/organization-context.decorator';
import { Permission } from '../common/authorization/permissions';

@Controller('sessions/:sessionId/speakers')
export class SessionSpeakersController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post(':speakerId')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromSession('sessionId')
  @RequirePermissions(Permission.SESSION_MANAGE)
  assignSpeaker(
    @Param('sessionId') sessionId: string,
    @Param('speakerId') speakerId: string,
  ) {
    return this.sessionsService.assignSpeaker(sessionId, speakerId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromSession('sessionId')
  @RequirePermissions(Permission.EVENT_READ)
  listSpeakers(@Param('sessionId') sessionId: string) {
    return this.sessionsService.listSpeakers(sessionId);
  }

  @Delete(':speakerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromSession('sessionId')
  @RequirePermissions(Permission.SESSION_MANAGE)
  async unassignSpeaker(
    @Param('sessionId') sessionId: string,
    @Param('speakerId') speakerId: string,
  ) {
    await this.sessionsService.unassignSpeaker(sessionId, speakerId);
  }
}