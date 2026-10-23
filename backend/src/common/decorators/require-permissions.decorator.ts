import { SetMetadata } from '@nestjs/common';
import { Permission } from '../authorization/permissions';

export const PERMISSIONS_KEY = 'permissions';

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);