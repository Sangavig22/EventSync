import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TicketTypesService } from './ticket-types.service';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { OrganizationFromEvent } from '../common/decorators/organization-context.decorator';
import { Permission } from '../common/authorization/permissions';

@Controller('events/:eventId/ticket-types')
export class TicketTypesController {
  constructor(private readonly ticketTypesService: TicketTypesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromEvent('eventId')
  @RequirePermissions(Permission.EVENT_UPDATE)
  create(
    @Param('eventId') eventId: string,
    @Body() createTicketTypeDto: CreateTicketTypeDto,
  ) {
    return this.ticketTypesService.create(eventId, createTicketTypeDto);
  }

  @Get()
  findAll(@Param('eventId') eventId: string) {
    return this.ticketTypesService.findAll(eventId);
  }
}