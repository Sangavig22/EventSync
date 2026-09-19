import { SetMetadata } from '@nestjs/common';

export type OrganizationContext =
  | { kind: 'param'; param: string }
  | { kind: 'resource'; model: 'event' | 'session'; param: string }
  | { kind: 'userMembership' };

export const ORG_CONTEXT_KEY = 'organization_context';

export const OrganizationFromEvent = (param = 'id'): MethodDecorator =>
  SetMetadata(ORG_CONTEXT_KEY, {
    kind: 'resource',
    model: 'event',
    param,
  });

export const OrganizationFromSession = (param = 'id'): MethodDecorator =>
  SetMetadata(ORG_CONTEXT_KEY, {
    kind: 'resource',
    model: 'session',
    param,
  });

export const OrganizationFromUserMembership = (): MethodDecorator =>
  SetMetadata(ORG_CONTEXT_KEY, { kind: 'userMembership' });