import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationsMembersController } from './organizations-members.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController, OrganizationsMembersController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}