import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { OrganizationRole } from '../../generated/prisma/client';

export class AddOrganizationMemberDto {
  @IsUUID()
  userId: string;

  @IsEnum(OrganizationRole)
  @IsNotEmpty()
  role: OrganizationRole;
}