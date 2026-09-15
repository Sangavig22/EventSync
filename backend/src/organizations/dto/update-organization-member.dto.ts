import { IsEnum, IsOptional } from 'class-validator';
import { OrganizationRole } from '../../generated/prisma/client';

export class UpdateOrganizationMemberDto {
  @IsOptional()
  @IsEnum(OrganizationRole)
  role?: OrganizationRole;
}