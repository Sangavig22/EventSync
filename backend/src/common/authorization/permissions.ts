import { OrganizationRole } from '../../generated/prisma/client';

export const Permission = {
  ORGANIZATION_READ: 'ORGANIZATION_READ',
  ORGANIZATION_UPDATE: 'ORGANIZATION_UPDATE',
  MEMBER_MANAGE: 'MEMBER_MANAGE',
  EVENT_READ: 'EVENT_READ',
  EVENT_CREATE: 'EVENT_CREATE',
  EVENT_UPDATE: 'EVENT_UPDATE',
  EVENT_PUBLISH: 'EVENT_PUBLISH',
  EVENT_DELETE: 'EVENT_DELETE',
  SESSION_MANAGE: 'SESSION_MANAGE',
  SPEAKER_MANAGE: 'SPEAKER_MANAGE',
  ANALYTICS_READ: 'ANALYTICS_READ',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ROLE_PERMISSIONS: Record<OrganizationRole, readonly Permission[]> = {
  [OrganizationRole.OWNER]: [
    Permission.ORGANIZATION_READ,
    Permission.ORGANIZATION_UPDATE,
    Permission.MEMBER_MANAGE,
    Permission.EVENT_READ,
    Permission.EVENT_CREATE,
    Permission.EVENT_UPDATE,
    Permission.EVENT_PUBLISH,
    Permission.EVENT_DELETE,
    Permission.SESSION_MANAGE,
    Permission.SPEAKER_MANAGE,
    Permission.ANALYTICS_READ,
  ],
  [OrganizationRole.ADMIN]: [
    Permission.ORGANIZATION_READ,
    Permission.ORGANIZATION_UPDATE,
    Permission.MEMBER_MANAGE,
    Permission.EVENT_READ,
    Permission.EVENT_CREATE,
    Permission.EVENT_UPDATE,
    Permission.EVENT_PUBLISH,
    Permission.SESSION_MANAGE,
    Permission.SPEAKER_MANAGE,
  ],
  [OrganizationRole.EDITOR]: [
    Permission.EVENT_READ,
    Permission.EVENT_CREATE,
    Permission.EVENT_UPDATE,
    Permission.SESSION_MANAGE,
    Permission.SPEAKER_MANAGE,
  ],
  [OrganizationRole.ANALYST]: [
    Permission.EVENT_READ,
    Permission.ANALYTICS_READ,
  ],
};