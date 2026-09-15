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
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { AddOrganizationMemberDto } from './dto/add-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';

@Controller('organizations/:organizationId/members')
export class OrganizationsMembersController {
  constructor(
    private readonly organizationsService: OrganizationsService,
  ) {}

  @Post()
  addMember(
    @Param('organizationId') organizationId: string,
    @Body() addOrganizationMemberDto: AddOrganizationMemberDto,
  ) {
    return this.organizationsService.addMember(
      organizationId,
      addOrganizationMemberDto,
    );
  }

  @Get()
  listMembers(@Param('organizationId') organizationId: string) {
    return this.organizationsService.listMembers(organizationId);
  }

  @Patch(':userId')
  updateMember(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @Body() updateOrganizationMemberDto: UpdateOrganizationMemberDto,
  ) {
    return this.organizationsService.updateMember(
      organizationId,
      userId,
      updateOrganizationMemberDto,
    );
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
  ) {
    await this.organizationsService.removeMember(organizationId, userId);
  }
}