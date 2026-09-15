import { SetMetadata } from '@nestjs/common';

export type OrganizationContext =
  | { kind: 'param'; param: string }
  | { kind: 'resource'; model: 'event'; param: string };

export const ORG_CONTEXT_KEY = 'organization_context';

export const OrganizationFromEvent = (param = 'id'): MethodDecorator =>
  SetMetadata(ORG_CONTEXT_KEY, {
    kind: 'resource',
    model: 'event',
    param,
  });