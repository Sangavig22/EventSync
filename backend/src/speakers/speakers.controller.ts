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
import { SpeakersService } from './speakers.service';
import { CreateSpeakerDto } from './dto/create-speaker.dto';
import { UpdateSpeakerDto } from './dto/update-speaker.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { OrganizationFromUserMembership } from '../common/decorators/organization-context.decorator';
import { Permission } from '../common/authorization/permissions';

@Controller('speakers')
export class SpeakersController {
  constructor(private readonly speakersService: SpeakersService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromUserMembership()
  @RequirePermissions(Permission.SPEAKER_MANAGE)
  create(@Body() createSpeakerDto: CreateSpeakerDto) {
    return this.speakersService.create(createSpeakerDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.speakersService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.speakersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromUserMembership()
  @RequirePermissions(Permission.SPEAKER_MANAGE)
  update(@Param('id') id: string, @Body() updateSpeakerDto: UpdateSpeakerDto) {
    return this.speakersService.update(id, updateSpeakerDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @OrganizationFromUserMembership()
  @RequirePermissions(Permission.SPEAKER_MANAGE)
  async remove(@Param('id') id: string) {
    await this.speakersService.remove(id);
  }
}